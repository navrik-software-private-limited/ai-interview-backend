const crypto = require("crypto");
const { Server } = require("socket.io");
const env = require("../config/env");
const logger = require("../logs/logger");
const { verifyInterviewAccessTokenSocketMiddleware } = require("../middleware/verifyInterviewAccessToken");
const sessionStore = require("../session/sessionStore");
const sessionRepository = require("../session/sessionRepository");
const { EVENT_NAME, emitEnvelope } = require("./envelope");
const peerConnectionManager = require("../webrtc/peerConnectionManager");
const interviewController = require("../interviewer/interviewController");
const textExtractor = require("../jd-resume/textExtractor");
const contextBuilder = require("../jd-resume/contextBuilder");
const faceTrackingService = require("../face-tracking/faceTrackingService");
const caseFlowController = require("../case-study/caseFlowController");

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

  await emitEnvelope(io, ctx.sessionId, "session.ready", { resumed });
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
  peerConnectionManager.closePeerConnection(sessionId);
  await sessionRepository.markSessionAbandoned(sessionId);
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
