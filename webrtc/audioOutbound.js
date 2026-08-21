const SAMPLE_RATE = 48000;
const FRAME_MS = 10;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_MS) / 1000; // 480

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// sessionId -> the tail Promise of that session's playback queue. Defense in
// depth alongside webrtc/turnGate.js: even if two playPcmBuffer calls ever
// fired close together, this guarantees their 10ms frames can never
// interleave on the same outbound RTCAudioSource (which is what garbled/
// overlapping audio would otherwise sound like) — the second call simply
// waits for the first to finish before it starts pushing frames.
const playbackQueues = new Map();

async function playPcmBuffer(sessionId, pcmBuffer) {
  const previous = playbackQueues.get(sessionId) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => playPcmBufferNow(sessionId, pcmBuffer));
  playbackQueues.set(sessionId, next);
  return next;
}

// Paces a PCM16LE mono @48000Hz buffer out through the session's outbound
// RTCAudioSource in real-time 10ms frames. Lazy-requires peerConnectionManager
// to avoid a circular require back to audioInbound/interviewController.
async function playPcmBufferNow(sessionId, pcmBuffer) {
  const peerConnectionManager = require("./peerConnectionManager");
  const audioSource = peerConnectionManager.getAudioSource(sessionId);
  if (!audioSource) return; // connection closed mid-response; drop remaining audio

  const totalSamples = pcmBuffer.length / 2; // Int16 = 2 bytes/sample
  const int16 = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, totalSamples);

  for (let offset = 0; offset < totalSamples; offset += SAMPLES_PER_FRAME) {
    const stillLive = peerConnectionManager.getAudioSource(sessionId);
    if (!stillLive) break;

    const frame = int16.subarray(offset, Math.min(offset + SAMPLES_PER_FRAME, totalSamples));
    const samples = new Int16Array(SAMPLES_PER_FRAME); // pad final frame with silence
    samples.set(frame);

    stillLive.onData({
      samples,
      sampleRate: SAMPLE_RATE,
      bitsPerSample: 16,
      channelCount: 1,
      numberOfFrames: SAMPLES_PER_FRAME,
    });

    await sleep(FRAME_MS);
  }
}

function clearSession(sessionId) {
  playbackQueues.delete(sessionId);
}

module.exports = { playPcmBuffer, clearSession };
