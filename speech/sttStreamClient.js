const env = require("../config/env");
const logger = require("../logs/logger");
const { concatInt16 } = require("./wav");
const sttClient = require("./sttClient");

// doc/real_time_interview_communication_improvement.md Phase 5: ElevenLabs'
// realtime STT over WebSocket (wss://.../v1/speech-to-text/realtime),
// commit_strategy=manual so THIS codebase's own VAD/turn-detection
// (webrtc/audioInbound.js) stays the single source of truth for "the
// candidate is done talking" — the stream just gets a commit:true message
// at the same moment audioInbound.js would have flushed the buffer today.
// pcm_48000 is a supported audio_format, matching this pipeline's existing
// sample rate exactly — no resampling needed.
//
// Session-keyed module-level state, same pattern as webrtc/conversationGate.js.
// One WebSocket per in-progress UTTERANCE, not per session lifetime — always
// closed (see finishTranscription/closeSession) once that utterance's
// transcript is resolved, so the next utterance opens a fresh connection.
const streams = new Map(); // sessionId -> StreamState

const COMMIT_TIMEOUT_MS = 8000;
// ElevenLabs' own reference chunk size is ~1s of audio; batching ~100ms of
// frames client-side before sending keeps message count reasonable (~10/sec)
// while still being meaningfully "streaming" rather than one giant burst.
const BATCH_SAMPLES = 4800; // 100ms @ 48000Hz

function buildUrl(sampleRate) {
  const params = new URLSearchParams({
    model_id: env.elevenLabs.sttRealtimeModelId,
    audio_format: `pcm_${sampleRate}`,
    commit_strategy: "manual",
  });
  return `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params.toString()}`;
}

function handleMessage(sessionId, event) {
  const state = streams.get(sessionId);
  if (!state) return;

  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch (err) {
    return;
  }

  if (payload.message_type === "partial_transcript") {
    state.onPartialTranscript(payload.text || "");
  } else if (payload.message_type === "committed_transcript") {
    const resolvers = state.committedResolvers.splice(0);
    resolvers.forEach((resolve) => resolve(payload.text || ""));
  } else if (payload.message_type && payload.message_type !== "session_started") {
    // Every other known message_type in ElevenLabs' realtime API is an
    // error/warning variant (error, auth_error, quota_exceeded,
    // rate_limited, input_error, invalid_request, commit_throttled, ...) —
    // treat any of them as "this stream can no longer be trusted," letting
    // finishTranscription's timeout/fallback take over rather than trying
    // to enumerate every current and future error type by name.
    logger.warn(`sttStreamClient: realtime STT ${payload.message_type} sessionId=${sessionId}: ${payload.error || ""}`);
    state.healthy = false;
    // Verified against a real production log: commit_throttled (a rejected
    // final commit — e.g. too little uncommitted audio) used to leave
    // finishTranscription's Promise.race with nothing to do but sit out the
    // full COMMIT_TIMEOUT_MS (8s of pure dead air) before falling back to
    // batch STT, even though this message already tells us definitively
    // that no committed_transcript is ever coming for the current commit.
    // Resolving with null (not a string) here makes finishTranscription's
    // existing `typeof text === "string"` check correctly fall through to
    // the batch fallback immediately instead.
    const resolvers = state.committedResolvers.splice(0);
    resolvers.forEach((resolve) => resolve(null));
  }
}

// Fire-and-forget by design — audio capture (webrtc/audioInbound.js) must
// never depend on this succeeding. onPartialTranscript is called with each
// interim transcript string as it arrives.
function openIfNeeded(sessionId, sampleRate, onPartialTranscript = () => {}) {
  if (streams.has(sessionId)) return;
  if (!env.elevenLabs.apiKey) return; // finishTranscription falls back to batch STT

  const state = {
    ws: null,
    healthy: false,
    pending: [],
    pendingSampleCount: 0,
    committedResolvers: [],
    onPartialTranscript,
  };
  streams.set(sessionId, state);

  try {
    const ws = new WebSocket(buildUrl(sampleRate), { headers: { "xi-api-key": env.elevenLabs.apiKey } });
    state.ws = ws;
    ws.addEventListener("open", () => {
      state.healthy = true;
    });
    ws.addEventListener("message", (event) => handleMessage(sessionId, event));
    ws.addEventListener("error", () => {
      state.healthy = false;
    });
    ws.addEventListener("close", () => {
      state.healthy = false;
    });
  } catch (err) {
    logger.warn(`sttStreamClient: failed to open realtime STT stream sessionId=${sessionId}:`, err.message);
    state.healthy = false;
  }
}

function flushPending(sessionId, commit) {
  const state = streams.get(sessionId);
  if (!state) return;

  const merged = concatInt16(state.pending);
  state.pending = [];
  state.pendingSampleCount = 0;

  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;

  state.ws.send(
    JSON.stringify({
      message_type: "input_audio_chunk",
      audio_base_64: merged.toString("base64"),
      commit,
    })
  );
}

function sendChunk(sessionId, samples) {
  const state = streams.get(sessionId);
  if (!state || !state.healthy) return;

  state.pending.push(samples);
  state.pendingSampleCount += samples.length;
  if (state.pendingSampleCount >= BATCH_SAMPLES) {
    flushPending(sessionId, false);
  }
}

// Tiered fallback, same philosophy as speech/ttsClient.js's speak() chain:
// if the stream was never opened, went unhealthy, or the commit times out,
// falls back to the existing batch sttClient.transcribeUtterance on the
// same PCM the caller already has buffered — streaming failure never loses
// an utterance. Always closes the session's stream before returning, so the
// next utterance's openIfNeeded starts a fresh connection.
async function finishTranscription(sessionId, fallbackPcmBuffer, sampleRate) {
  const state = streams.get(sessionId);
  try {
    if (state && state.healthy) {
      flushPending(sessionId, true);
      const text = await Promise.race([
        new Promise((resolve) => state.committedResolvers.push(resolve)),
        new Promise((resolve) => setTimeout(() => resolve(null), COMMIT_TIMEOUT_MS)),
      ]);
      if (typeof text === "string") return text;
    }
  } catch (err) {
    logger.warn(`sttStreamClient: streaming transcription failed sessionId=${sessionId}, falling back to batch:`, err.message);
  } finally {
    closeSession(sessionId);
  }
  return sttClient.transcribeUtterance(fallbackPcmBuffer, sampleRate);
}

function closeSession(sessionId) {
  const state = streams.get(sessionId);
  if (!state) return;
  streams.delete(sessionId);
  try {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.close();
  } catch (err) {
    // best-effort close — nothing left to protect once we're tearing down
  }
}

module.exports = { openIfNeeded, sendChunk, finishTranscription, closeSession };
