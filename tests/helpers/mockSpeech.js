// speech/sttClient.js and speech/ttsClient.js already degrade gracefully to
// deterministic mock/silent output when ELEVENLABS_API_KEY (and
// ELEVENLABS_TTS_VOICE_ID for TTS) are unset — which is exactly the state in
// the test environment (.env.test intentionally leaves them blank). So most
// tests don't need to `jest.mock` these at all; they can just assert against
// the known fallback values exported here, and only mock the module directly
// in tests that need to force an ERROR (not just "no key configured") to
// exercise interviewController.js's tiered TTS fallback.

const MOCK_TRANSCRIPT = "[mock transcript — ELEVENLABS_API_KEY not configured]";
const SILENCE_FALLBACK_MS = 500;

function silentPcmBuffer(ms = SILENCE_FALLBACK_MS) {
  const sampleCount = Math.round((48000 * ms) / 1000);
  return Buffer.alloc(sampleCount * 2);
}

module.exports = { MOCK_TRANSCRIPT, SILENCE_FALLBACK_MS, silentPcmBuffer };
