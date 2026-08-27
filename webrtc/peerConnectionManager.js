const wrtc = require("@roamhq/wrtc");
const { RTCPeerConnection, nonstandard } = wrtc;
const { RTCAudioSink, RTCAudioSource } = nonstandard;
const logger = require("../logs/logger");
const { emitEnvelope } = require("../communication/envelope");
const audioInbound = require("./audioInbound");
const { getIceServers } = require("./iceServersConfig");
const { forwardConnectivityEvent } = require("../proctoring/sources/connectivityEventAdapter");
const { SEVERITY } = require("../proctoring/severityClassifier");

// sessionId -> { pc, audioSource, outboundTrack, audioSink, hasStartedInterview, isDegraded }
const peerConnections = new Map();

async function handleOffer(sessionId, sdp, io) {
  const existing = peerConnections.get(sessionId);
  if (existing) {
    // Renegotiation (e.g. an ICE restart after "disconnected") on an
    // already-established connection — reuse the existing pc/audio pipeline
    // instead of constructing a new one and orphaning the live interview.
    await existing.pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await existing.pc.createAnswer();
    await existing.pc.setLocalDescription(answer);
    await emitEnvelope(io, sessionId, "webrtc.answer", { sdp: existing.pc.localDescription.sdp });
    return;
  }

  const pc = new RTCPeerConnection({ iceServers: getIceServers() });

  // Terminates the candidate's camera; frames are not consumed until Phase 3
  // face tracking is built.
  pc.addTransceiver("video", { direction: "recvonly" });

  const audioSource = new RTCAudioSource();
  const outboundTrack = audioSource.createTrack();
  pc.addTrack(outboundTrack);

  pc.ontrack = (event) => {
    if (event.track.kind !== "audio") return;
    const sink = new RTCAudioSink(event.track);
    sink.ondata = (data) => audioInbound.handleInboundAudioFrame(sessionId, data, io);
    const entry = peerConnections.get(sessionId);
    if (entry) entry.audioSink = sink;
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      emitEnvelope(io, sessionId, "webrtc.ice_candidate", { candidate: event.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    logger.info(`webrtc connectionState sessionId=${sessionId} state=${pc.connectionState}`);
    const entry = peerConnections.get(sessionId);

    if (pc.connectionState === "connected") {
      emitEnvelope(io, sessionId, "webrtc.connected", {});
      emitEnvelope(io, sessionId, "media.ready", {});

      if (entry && entry.isDegraded) {
        entry.isDegraded = false;
        emitEnvelope(io, sessionId, "media.recovered", {});
        // doc/07 gap #4: INFORMATIONAL so recovery never adds to the
        // integrity-score penalty — mirrors FACE_PRESENT's role.
        forwardConnectivityEvent(io, sessionId, { eventType: "MEDIA_RECOVERED", severity: SEVERITY.INFORMATIONAL });
      }

      if (entry && !entry.hasStartedInterview) {
        entry.hasStartedInterview = true;
        // Lazy require to avoid a circular top-level dependency with interviewController,
        // which in turn needs peerConnectionManager.closePeerConnection() in endSession.
        const interviewController = require("../interviewer/interviewController");
        // Fire-and-forget by necessity (this is a synchronous WebRTC event
        // callback), but that previously meant any error inside
        // startInterview (LLM/TTS/DB call failing) became a silent
        // unhandled rejection — WebRTC shows "connected", media.ready
        // fires, and the interview then never actually starts with no
        // signal to the candidate or the logs about why. Catch it, log it,
        // tell the frontend, and let a later reconnect retry.
        interviewController.startInterview(io, sessionId).catch((err) => {
          logger.error(`startInterview failed sessionId=${sessionId}:`, err.message);
          entry.hasStartedInterview = false;
          emitEnvelope(io, sessionId, "session.warning", { reason: "interview_start_failed" });
        });
      }
    }

    // "disconnected" is often transient (brief network hiccup) — treat it as
    // recoverable rather than a hard failure; only "failed" is fatal.
    if (pc.connectionState === "disconnected") {
      if (entry) entry.isDegraded = true;
      emitEnvelope(io, sessionId, "media.degraded", {});
      // doc/07 gap #4: connectivity-monitor proctoring source — forwards an
      // already-detected condition, no new client instrumentation needed.
      forwardConnectivityEvent(io, sessionId, { eventType: "MEDIA_DEGRADED", severity: SEVERITY.WARNING });
    }

    if (pc.connectionState === "failed") {
      emitEnvelope(io, sessionId, "webrtc.failed", {});
      forwardConnectivityEvent(io, sessionId, { eventType: "MEDIA_FAILED", severity: SEVERITY.CRITICAL });
    }
  };

  await pc.setRemoteDescription({ type: "offer", sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  peerConnections.set(sessionId, {
    pc,
    audioSource,
    outboundTrack,
    audioSink: null,
    hasStartedInterview: false,
    isDegraded: false,
  });

  await emitEnvelope(io, sessionId, "webrtc.answer", { sdp: pc.localDescription.sdp });
}

async function addIceCandidate(sessionId, candidate) {
  const entry = peerConnections.get(sessionId);
  if (!entry || !candidate) return;
  try {
    await entry.pc.addIceCandidate(candidate);
  } catch (err) {
    logger.warn(`addIceCandidate failed sessionId=${sessionId}:`, err.message);
  }
}

function getAudioSource(sessionId) {
  const entry = peerConnections.get(sessionId);
  return entry ? entry.audioSource : null;
}

function closePeerConnection(sessionId) {
  const entry = peerConnections.get(sessionId);
  if (!entry) return;
  try {
    if (entry.audioSink) entry.audioSink.stop();
    entry.pc.close();
  } catch (err) {
    logger.warn(`closePeerConnection error sessionId=${sessionId}:`, err.message);
  }
  peerConnections.delete(sessionId);
}

module.exports = { handleOffer, addIceCandidate, getAudioSource, closePeerConnection };
