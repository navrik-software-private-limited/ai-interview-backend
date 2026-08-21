const SAMPLE_RATE = 48000;
const WINDOW_MS = 100;
const SAMPLES_PER_WINDOW = (SAMPLE_RATE * WINDOW_MS) / 1000; // 4800

// ai.visemes fallback: ElevenLabs (speech/ttsClient.js) doesn't expose
// native phoneme/viseme timing (only character-level timestamps, on a
// different endpoint) — so per 03-LIVE-INTERVIEW-MODULE.md's fallback
// instruction, this derives a plain amplitude envelope from the
// already-synthesized PCM16LE mono @48kHz buffer instead. The frontend
// avatar interpolates mouth-openness from this envelope; it isn't real
// phoneme shaping, just enough signal to visibly lip-sync rather than play
// audio over a static avatar.
function estimateEnvelope(pcmBuffer) {
  const totalSamples = pcmBuffer.length / 2; // Int16 = 2 bytes/sample
  const int16 = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, totalSamples);

  const visemes = [];
  for (let offset = 0; offset < totalSamples; offset += SAMPLES_PER_WINDOW) {
    const end = Math.min(offset + SAMPLES_PER_WINDOW, totalSamples);
    let sumSquares = 0;
    for (let i = offset; i < end; i++) {
      const normalized = int16[i] / 32768;
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / (end - offset));
    // Empirically, normal speech RMS on this pipeline sits well under 0.3 —
    // scale so typical speech reaches close to 1.0 without clipping silence to 0.
    const amplitude = Math.min(1, rms / 0.3);
    visemes.push({ t: Math.round((offset / SAMPLE_RATE) * 1000), amplitude: Math.round(amplitude * 100) / 100 });
  }

  const durationMs = Math.round((totalSamples / SAMPLE_RATE) * 1000);
  return { visemes, durationMs };
}

module.exports = { estimateEnvelope };
