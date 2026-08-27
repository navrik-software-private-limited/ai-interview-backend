const { concatInt16, computeRms } = require("../speech/wav");
const conversationGate = require("./conversationGate");
const turnMetrics = require("../interviewer/turnMetrics");
const { emitEnvelope } = require("../communication/envelope");
const sttStreamClient = require("../speech/sttStreamClient");

const SILENCE_RMS_THRESHOLD = 500;
// doc/real_time_interview_communication_improvement.md §5/§6 (Phase 2): a
// short pause no longer ends the utterance — 700ms of silence used to mean
// "done" on its own, which cut candidates off mid-thought. Now that's just
// "maybe pausing"; only COMPLETION_SILENCE_MS of silence actually flushes.
// MAX_UTTERANCE_MS is a safety cap so a VAD edge case (or a candidate who
// just keeps talking) can't buffer forever.
const COMPLETION_SILENCE_MS = 1400;
const MAX_UTTERANCE_MS = 45000;
const MIN_UTTERANCE_MS = 300;
const FRAME_MS = 10; // RTCAudioSink delivers ~10ms frames
// doc §7/§8 (Phase 3): higher confidence bar than passive listening before
// committing to a barge-in — useWebRTC.js already requests browser-native
// echoCancellation, so this isn't distinguishing real echo from speech from
// scratch, just tolerating whatever imperfect real-world AEC leaves behind.
// A single loud frame (a pop, a click) never triggers this; only sustained
// speech does.
const BARGE_IN_SPEECH_MS = 200;

const buffers = new Map(); // sessionId -> { chunks, silenceMs, speakingMs, totalMs, sampleRate }
const bargeInCandidates = new Map(); // sessionId -> { chunks, speakingMs } — only tracked while the AI is busy

function freshState(sampleRate) {
  return { chunks: [], silenceMs: 0, speakingMs: 0, totalMs: 0, sampleRate };
}

// doc/real_time_interview_communication_improvement.md Phase 5: opens the
// realtime STT stream at the same moment a fresh utterance starts (fire-and-
// forget — see sttStreamClient.js's own comment on why). Partial transcripts
// are surfaced live as transcript.partial — an envelope type/UI state
// (practywiz-frontend's partialTranscript) that already existed and was
// already wired, just never emitted by this backend until now.
function startStreamingStt(sessionId, sampleRate, io) {
  sttStreamClient.openIfNeeded(sessionId, sampleRate, (text) => {
    turnMetrics.mark(sessionId, "sttFirstPartial"); // no-op after the first call — turnMetrics.mark dedupes per label
    emitEnvelope(io, sessionId, "transcript.partial", { speaker: "candidate", text });
  });
}

function flushUtterance(sessionId, state, io) {
  const utterancePcm = concatInt16(state.chunks);
  buffers.delete(sessionId);
  turnMetrics.mark(sessionId, "candidateSpeechEnd");

  const interviewController = require("../interviewer/interviewController");
  interviewController.onCandidateUtterance(io, sessionId, utterancePcm, state.sampleRate);
}

// Simple energy-based VAD: buffers speech frames per session and, once a
// long-enough pause follows a long-enough utterance, hands the merged PCM to
// the interview controller for STT. Lazy-requires interviewController to
// avoid a circular require (peerConnectionManager -> audioInbound ->
// interviewController -> audioOutbound -> peerConnectionManager).
function handleInboundAudioFrame(sessionId, frame, io) {
  const { samples, sampleRate } = frame;
  const isSpeech = computeRms(samples) > SILENCE_RMS_THRESHOLD;

  if (conversationGate.isAiBusy(sessionId)) {
    // doc Phase 3: while the AI is thinking/speaking, don't drop everything
    // outright anymore — watch for sustained genuine speech (a barge-in)
    // instead. An isolated frame (most likely residual echo/noise) resets
    // this counter rather than accumulating toward anything.
    if (!isSpeech) {
      bargeInCandidates.delete(sessionId);
      return;
    }

    const candidate = bargeInCandidates.get(sessionId) || { chunks: [], speakingMs: 0 };
    candidate.chunks.push(samples);
    candidate.speakingMs += FRAME_MS;

    if (candidate.speakingMs < BARGE_IN_SPEECH_MS) {
      bargeInCandidates.set(sessionId, candidate);
      return;
    }

    bargeInCandidates.delete(sessionId);
    conversationGate.interrupt(sessionId);
    emitEnvelope(io, sessionId, "ai.interrupted", {});

    // Seed the normal utterance buffer with what was already captured while
    // confirming the barge-in, so the candidate's first ~200ms isn't lost —
    // continues exactly like an ordinary new utterance from here on.
    const state = freshState(sampleRate);
    state.chunks = candidate.chunks;
    state.speakingMs = candidate.speakingMs;
    state.totalMs = candidate.speakingMs;
    buffers.set(sessionId, state);
    turnMetrics.startTurn(sessionId);
    turnMetrics.mark(sessionId, "candidateSpeechStart");
    startStreamingStt(sessionId, sampleRate, io);
    for (const chunk of candidate.chunks) sttStreamClient.sendChunk(sessionId, chunk);
    return;
  }

  const state = buffers.get(sessionId) || freshState(sampleRate);

  if (isSpeech) {
    // doc/07 Phase 1: the first speech frame of a fresh buffer is
    // candidateSpeechStart — the earliest point this codebase can know the
    // candidate has started talking (again).
    if (!state.chunks.length) {
      turnMetrics.startTurn(sessionId);
      turnMetrics.mark(sessionId, "candidateSpeechStart");
      startStreamingStt(sessionId, sampleRate, io);
    }
    state.chunks.push(samples);
    state.speakingMs += FRAME_MS;
    state.silenceMs = 0;
    sttStreamClient.sendChunk(sessionId, samples);
  } else if (state.chunks.length) {
    state.silenceMs += FRAME_MS;
  }
  if (state.chunks.length) state.totalMs += FRAME_MS;

  const longEnoughToCount = state.speakingMs >= MIN_UTTERANCE_MS;
  const pausedLongEnoughToFinish = state.silenceMs >= COMPLETION_SILENCE_MS;
  const hitSafetyCap = state.totalMs >= MAX_UTTERANCE_MS;

  if (state.chunks.length && longEnoughToCount && (pausedLongEnoughToFinish || hitSafetyCap)) {
    flushUtterance(sessionId, state, io);
  } else {
    buffers.set(sessionId, state);
  }
}

function clearSession(sessionId) {
  buffers.delete(sessionId);
  bargeInCandidates.delete(sessionId);
  sttStreamClient.closeSession(sessionId);
}

module.exports = {
  handleInboundAudioFrame,
  clearSession,
  COMPLETION_SILENCE_MS,
  MAX_UTTERANCE_MS,
  MIN_UTTERANCE_MS,
  BARGE_IN_SPEECH_MS,
};
