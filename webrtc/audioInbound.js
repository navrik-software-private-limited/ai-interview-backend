const { concatInt16, computeRms } = require("../speech/wav");
const turnGate = require("./turnGate");

const SILENCE_RMS_THRESHOLD = 500;
const END_OF_UTTERANCE_SILENCE_MS = 700;
const MIN_UTTERANCE_MS = 300;
const FRAME_MS = 10; // RTCAudioSink delivers ~10ms frames

const buffers = new Map(); // sessionId -> { chunks, silenceMs, speakingMs, sampleRate }

// Simple energy-based VAD: buffers speech frames per session and, once a
// pause follows a long-enough utterance, hands the merged PCM to the
// interview controller for STT. Lazy-requires interviewController to avoid
// a circular require (peerConnectionManager -> audioInbound -> interviewController
// -> audioOutbound -> peerConnectionManager).
function handleInboundAudioFrame(sessionId, frame, io) {
  if (turnGate.isAiBusy(sessionId)) {
    // Half-duplex: while the AI is thinking/speaking, ignore inbound audio
    // entirely (it's most likely speaker bleed/echo of the AI's own voice,
    // not genuine candidate speech) and drop anything partially buffered so
    // it can't be misread as a real utterance once the gate lifts.
    buffers.delete(sessionId);
    return;
  }

  const { samples, sampleRate } = frame;
  const state = buffers.get(sessionId) || { chunks: [], silenceMs: 0, speakingMs: 0, sampleRate };

  const isSpeech = computeRms(samples) > SILENCE_RMS_THRESHOLD;
  if (isSpeech) {
    state.chunks.push(samples);
    state.speakingMs += FRAME_MS;
    state.silenceMs = 0;
  } else if (state.chunks.length) {
    state.silenceMs += FRAME_MS;
  }

  if (state.chunks.length && state.silenceMs >= END_OF_UTTERANCE_SILENCE_MS && state.speakingMs >= MIN_UTTERANCE_MS) {
    const utterancePcm = concatInt16(state.chunks);
    buffers.set(sessionId, { chunks: [], silenceMs: 0, speakingMs: 0, sampleRate });

    const interviewController = require("../interviewer/interviewController");
    interviewController.onCandidateUtterance(io, sessionId, utterancePcm, sampleRate);
  } else {
    buffers.set(sessionId, state);
  }
}

function clearSession(sessionId) {
  buffers.delete(sessionId);
}

module.exports = { handleInboundAudioFrame, clearSession };
