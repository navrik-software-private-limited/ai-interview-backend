const crypto = require("crypto");
const { Server } = require("socket.io");
const env = require("../config/env");
const logger = require("../logs/logger");
const { verifyInterviewAccessTokenSocketMiddleware } = require("../middleware/verifyInterviewAccessToken");
const sessionStore = require("../session/sessionStore");
const sessionRepository = require("../session/sessionRepository");
const { EVENT_NAME, emitEnvelope } = require("./envelope");
const peerConnectionManager = require("../webrtc/peerConnectionManager");
const { getIceServers } = require("../webrtc/iceServersConfig");
const conversationGate = require("../webrtc/conversationGate");
const audioOutbound = require("../webrtc/audioOutbound");
const audioInbound = require("../webrtc/audioInbound");
const interviewController = require("../interviewer/interviewController");
const evaluationPipeline = require("../evaluation/evaluationPipeline");
const textExtractor = require("../jd-resume/textExtractor");
const contextBuilder = require("../jd-resume/contextBuilder");
const faceTrackingService = require("../face-tracking/faceTrackingService");
const caseFlowController = require("../case-study/caseFlowController");
const activityMonitorService = require("../proctoring/activityMonitorService");
const codingActivityService = require("../proctoring/codingActivityService");
const { forwardConnectivityEvent } = require("../proctoring/sources/connectivityEventAdapter");
const { SEVERITY } = require("../proctoring/severityClassifier");

// sessionId -> pending abandonment Timeout, armed on disconnect and cleared
// on reconnect within the grace period (doc 03 §13: "should not immediately
// mark the interview abandoned").
const disconnectTimers = new Map();

// doc 04 §6 (JD/Resume Intelligence) + §7 (Case Study): best-effort,
// fire-and-forget — extracts resume text + folds in any pasted JD text into
// an LLM-structured resumeContext for the JD_RESUME section, and separately
// caches the real purchased case study's narrative text (already curated, no
// LLM structuring needed) for the CASE section. Never blocks session.ready;
// whatever hasn't finished (or has nothing to extract) by the time that
// section's first question/presentation happens just falls back to generic.
async function buildAndCacheResumeContext(sessionId) {
  try {
    const context = await sessionRepository.fetchSessionContext(sessionId);
    if (!context) return;

    const caseContentText = context.contextSnapshot && context.contextSnapshot.caseContentText;
    // Interview Dashboard – Resume & JD Integration Requirement.md §11: a
    // JD uploaded as a FILE (practywiz-backend's new candidate_job_descriptions
    // table, jd_source='FILE') only ever arrives here as a URL
    // (context.jdReference) — there was previously no extraction step for it
    // at all (unlike resumeReference, right below), so a file-uploaded JD's
    // content never actually reached question generation. Text pasted
    // directly (jd_source='TEXT', or a one-off override) still arrives
    // pre-extracted via contextSnapshot.jdText and skips this entirely.
    const [resumeText, jdText] = await Promise.all([
      context.resumeReference ? textExtractor.extractTextFromUrl(context.resumeReference) : null,
      context.contextSnapshot && context.contextSnapshot.jdText
        ? context.contextSnapshot.jdText
        : context.jdReference
          ? textExtractor.extractTextFromUrl(context.jdReference)
          : null,
    ]);

    const patch = {};
    if (caseContentText) {
      patch.caseContentText = caseContentText;
    }
    if (resumeText || jdText) {
      const resumeContext = await contextBuilder.buildResumeContext({ resumeText, jdText });
      if (resumeContext) patch.resumeContext = resumeContext;
    }

    if (Object.keys(patch).length) {
      await sessionStore.touchSession(sessionId, patch);
      logger.info(`resume/case context ready sessionId=${sessionId}`);
    }
  } catch (err) {
    logger.warn(`buildAndCacheResumeContext failed sessionId=${sessionId}:`, err.message);
  }
}

// 06-READINESS-CHECK-MODULE.md / 03-LIVE-INTERVIEW-MODULE.md §2.5: the
// session cannot reach ACTIVE until readiness has put it in READY — this is
// the structural enforcement (not just a frontend convention) of "the
// interview cannot start until all four readiness checks pass." ACTIVE stays
// allowed so a mid-interview reconnect is never bounced back to readiness.
async function isSessionJoinable(sessionId) {
  const status = await sessionRepository.fetchSessionStatus(sessionId);
  return status === "READY" || status === "ACTIVE";
}

async function handleSessionConnect(io, socket, ctx) {
  const pendingAbandon = disconnectTimers.get(ctx.sessionId);
  if (pendingAbandon) {
    clearTimeout(pendingAbandon);
    disconnectTimers.delete(ctx.sessionId);
  }

  const { session, resumed } = await sessionStore.createOrResumeSession(ctx.sessionId, {
    candidateId: ctx.candidateId,
    interviewId: ctx.interviewId,
  });
  await sessionStore.touchSession(ctx.sessionId, { connectionId: socket.id });
  sessionRepository.markSessionActive(ctx.sessionId);

  if (!resumed && !session.resumeContext) {
    buildAndCacheResumeContext(ctx.sessionId);
  }

  // doc/07_INTERVIEW_MODULE_STATUS_AND_ROADMAP.md gap #3: the frontend has no
  // other channel that reaches it before WebRTC negotiation begins, so this
  // is how the browser's RTCPeerConnection actually learns about TURN (once
  // configured) — see practywiz-frontend's useWebRTC.js.
  await emitEnvelope(io, ctx.sessionId, "session.ready", { resumed, iceServers: getIceServers() });
  logger.info(`session.ready sessionId=${ctx.sessionId} resumed=${resumed}`);
}

// doc 03 §12: client sends its last received sequence, server replays
// everything after it. Replayed directly to the requesting socket (not
// room-broadcast) so a lingering stale connection can't receive it twice.
async function handleSessionResume(socket, sessionId, lastSequence) {
  const missed = await sessionRepository.fetchSessionEventsSinceSequence(sessionId, lastSequence);
  for (const event of missed) {
    socket.emit(EVENT_NAME, event);
  }
  logger.info(`session.resume sessionId=${sessionId} replayed=${missed.length} events`);
}

async function handleInboundEnvelope(io, socket, envelope) {
  const { sessionId } = socket.data.session;
  if (!envelope || envelope.sessionId !== sessionId) return;

  try {
    await routeInboundEnvelope(io, socket, sessionId, envelope);
  } catch (err) {
    // Without this, a thrown error anywhere in a handler below (e.g. an LLM
    // or TTS call failing) becomes a silent unhandled rejection — the
    // section/session state already changed, but the AI never speaks again
    // and nothing gets logged pointing at why.
    logger.error(`handleInboundEnvelope failed type=${envelope.type} sessionId=${sessionId}:`, err.message);
  }
}

async function routeInboundEnvelope(io, socket, sessionId, envelope) {
  switch (envelope.type) {
    case "webrtc.offer":
      await peerConnectionManager.handleOffer(sessionId, envelope.payload.sdp, io);
      break;
    case "webrtc.ice_candidate":
      await peerConnectionManager.addIceCandidate(sessionId, envelope.payload.candidate);
      break;
    case "session.end":
      await interviewController.endSession(io, sessionId, envelope.payload && envelope.payload.reason);
      break;
    case "session.resume":
      await handleSessionResume(socket, sessionId, envelope.payload && envelope.payload.lastSequence);
      await emitEnvelope(io, sessionId, "session.resumed", {});
      await emitEnvelope(io, sessionId, "session.state", { status: "ACTIVE" });
      break;
    case "heartbeat":
      await sessionStore.touchSession(sessionId, {});
      break;
    case "face.status":
      await faceTrackingService.handleFaceEvent(io, sessionId, envelope.payload);
      break;
    case "activity.status":
      await activityMonitorService.handleActivityEvent(io, sessionId, envelope.payload);
      break;
    case "coding.activity":
      await codingActivityService.handlePasteEvent(io, sessionId, envelope.payload);
      break;
    case "case.acknowledged":
      await caseFlowController.acknowledgeCase(io, sessionId);
      break;
    case "coding.submit":
      await interviewController.handleCodingSubmission(io, sessionId, envelope.payload);
      break;
    case "mcq.submit":
      await interviewController.handleMcqSubmission(io, sessionId, envelope.payload);
      break;
    case "question.skip":
      await interviewController.handleSkip(io, sessionId);
      break;
    case "section.skip":
      await interviewController.handleSkipSection(io, sessionId);
      break;
    default:
      logger.warn(`Unhandled inbound envelope type: ${envelope.type}`);
  }
}

// doc 03 §13: no immediate abandonment — arm a grace-period timer instead.
async function handleAbandoned(io, sessionId) {
  disconnectTimers.delete(sessionId);
  logger.info(`session abandoned (no reconnect within grace period) sessionId=${sessionId}`);
  await emitEnvelope(io, sessionId, "session.failed", { reason: "abandoned" });
  // doc/07 gap #4: the candidate never reconnected — real integrity-relevant
  // evidence, not just a connectivity blip.
  forwardConnectivityEvent(io, sessionId, { eventType: "SESSION_ABANDONED", severity: SEVERITY.CRITICAL });
  peerConnectionManager.closePeerConnection(sessionId);
  await sessionRepository.markSessionAbandoned(sessionId);

  // doc/07_INTERVIEW_MODULE_STATUS_AND_ROADMAP.md gap #11: this used to be a
  // dead end — no report was ever generated for a session that never
  // reconnected, leaving it stuck showing "Interview in progress" on the
  // Reports tab forever. ABANDONED is just as terminal as COMPLETED (see
  // evaluation/sessionDataLoader.js's TERMINAL_STATUSES), and every evaluator
  // downstream already degrades to "Insufficient data" for thin/empty input,
  // so this is safe even for a session abandoned seconds in. Same
  // fire-and-forget pattern as interviewer/interviewController.js's
  // endSession — must never block/delay cleanup below.
  await emitEnvelope(io, sessionId, "report.started", {});
  evaluationPipeline.generateReport(sessionId).catch((err) => {
    logger.error(`report generation failed sessionId=${sessionId}:`, err.message);
  });

  // doc/real_time_interview_communication_improvement.md Phase 5: found
  // while adding sttStreamClient's own teardown — interviewController.js's
  // endSession already clears these three (a clean finish), but this
  // abandonment path never did, leaking each session's in-memory turn/
  // playback/VAD/STT-stream state indefinitely. Same cleanup, same order.
  conversationGate.clearSession(sessionId);
  audioOutbound.clearSession(sessionId);
  audioInbound.clearSession(sessionId);
  await sessionStore.endSession(sessionId);
}

async function handleDisconnect(io, socket, reason) {
  const ctx = socket.data.session;
  if (!ctx) return;
  logger.info(`socket disconnected sessionId=${ctx.sessionId} reason=${reason}`);
  await sessionStore.touchSession(ctx.sessionId, { connectionId: null, status: "RECONNECTING" });
  await emitEnvelope(io, ctx.sessionId, "session.reconnecting", { reason });
  await emitEnvelope(io, ctx.sessionId, "session.warning", {
    reason: "connection_lost",
    graceMs: env.reconnectGracePeriodMs,
  });
  // doc/07 gap #4: connectivity-monitor proctoring source — forwards an
  // already-detected condition, no new client instrumentation needed.
  forwardConnectivityEvent(io, ctx.sessionId, { eventType: "SESSION_DISCONNECTED", severity: SEVERITY.WARNING, metadata: { reason } });

  const timer = setTimeout(() => handleAbandoned(io, ctx.sessionId), env.reconnectGracePeriodMs);
  disconnectTimers.set(ctx.sessionId, timer);
}

function attachSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.corsOrigin, methods: ["GET", "POST"] },
  });

  io.use(verifyInterviewAccessTokenSocketMiddleware);

  io.on("connection", async (socket) => {
    const ctx = socket.data.session;

    if (!(await isSessionJoinable(ctx.sessionId))) {
      logger.warn(`socket connect rejected — session not ready sessionId=${ctx.sessionId}`);
      socket.emit(EVENT_NAME, {
        eventId: crypto.randomUUID(),
        sessionId: ctx.sessionId,
        type: "session.failed",
        timestamp: new Date().toISOString(),
        sequence: 0,
        payload: { reason: "not_ready" },
      });
      socket.disconnect(true);
      return;
    }

    socket.join(ctx.sessionId);
    handleSessionConnect(io, socket, ctx);

    socket.on(EVENT_NAME, (envelope) => handleInboundEnvelope(io, socket, envelope));
    socket.on("disconnect", (reason) => handleDisconnect(io, socket, reason));
  });

  return io;
}

module.exports = { attachSocketServer };
