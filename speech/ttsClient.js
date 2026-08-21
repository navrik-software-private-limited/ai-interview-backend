const axios = require("axios");
const env = require("../config/env");
const logger = require("../logs/logger");

const SILENCE_FALLBACK_MS = 500;
const SAMPLE_RATE = 48000;

// Interview Module – Bug, Gap & UI/UX Improvements.md §3: how much audio to
// accumulate before handing a chunk to the caller (interviewController.js's
// speak()) for playback. Small enough to keep time-to-first-audio low,
// large enough not to spam audioOutbound.playPcmBuffer with tiny calls.
const STREAM_CHUNK_MS = 100;
const STREAM_CHUNK_BYTES = ((SAMPLE_RATE * STREAM_CHUNK_MS) / 1000) * 2; // 2 bytes/sample (Int16)

function silentPcmBuffer(ms) {
  const sampleCount = Math.round((SAMPLE_RATE * ms) / 1000);
  return Buffer.alloc(sampleCount * 2); // Int16LE zeros = silence
}

// ElevenLabs Text-to-Speech, requesting raw PCM directly (output_format=pcm_48000)
// so the result can be fed straight into RTCAudioSource without decoding MP3/Opus.
// Non-streaming — resolves only once the entire response body has arrived.
// Kept for speech/ttsCache.js's cached static phrases, where the whole
// buffer is wanted upfront anyway; the live speak() path uses
// synthesizeSpeechStreaming below instead.
async function synthesizeSpeech(text) {
  if (!env.elevenLabs.apiKey || !env.elevenLabs.ttsVoiceId) {
    logger.warn("ELEVENLABS_API_KEY/ELEVENLABS_TTS_VOICE_ID not set — skipping real TTS, playing silence instead");
    return silentPcmBuffer(SILENCE_FALLBACK_MS);
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${env.elevenLabs.ttsVoiceId}/stream?output_format=pcm_48000`;

  const res = await axios.post(
    url,
    { text, model_id: env.elevenLabs.ttsModelId },
    {
      headers: { "xi-api-key": env.elevenLabs.apiKey, "Content-Type": "application/json" },
      responseType: "arraybuffer",
      maxBodyLength: Infinity,
    }
  );

  return Buffer.from(res.data); // PCM16LE mono @ 48000Hz
}

// Same ElevenLabs endpoint, but consumed as a true HTTP stream
// (responseType: "stream") instead of buffering the whole response before
// resolving — that buffering was the actual cause of the "delay before the
// interviewer starts speaking" complaint, not TTS generation speed itself.
// Invokes onChunk(pcmBuffer) as each ~100ms slice of audio arrives, so the
// caller can start playback immediately instead of waiting for the full
// response. Resolves with the complete concatenated buffer once the stream
// ends, for callers that also need the full audio (viseme envelope,
// transcript persistence).
async function synthesizeSpeechStreaming(text, onChunk) {
  if (!env.elevenLabs.apiKey || !env.elevenLabs.ttsVoiceId) {
    logger.warn("ELEVENLABS_API_KEY/ELEVENLABS_TTS_VOICE_ID not set — skipping real TTS, playing silence instead");
    const silence = silentPcmBuffer(SILENCE_FALLBACK_MS);
    if (onChunk) onChunk(silence);
    return silence;
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${env.elevenLabs.ttsVoiceId}/stream?output_format=pcm_48000`;

  const response = await axios.post(
    url,
    { text, model_id: env.elevenLabs.ttsModelId },
    {
      headers: { "xi-api-key": env.elevenLabs.apiKey, "Content-Type": "application/json" },
      responseType: "stream",
      maxBodyLength: Infinity,
    }
  );

  return new Promise((resolve, reject) => {
    const chunks = [];
    let pending = Buffer.alloc(0);

    response.data.on("data", (data) => {
      pending = Buffer.concat([pending, data]);
      while (pending.length >= STREAM_CHUNK_BYTES) {
        const chunk = pending.subarray(0, STREAM_CHUNK_BYTES);
        pending = pending.subarray(STREAM_CHUNK_BYTES);
        chunks.push(chunk);
        if (onChunk) onChunk(chunk);
      }
    });

    response.data.on("end", () => {
      if (pending.length > 0) {
        chunks.push(pending);
        if (onChunk) onChunk(pending);
      }
      resolve(Buffer.concat(chunks));
    });

    response.data.on("error", reject);
  });
}

module.exports = { synthesizeSpeech, synthesizeSpeechStreaming, silentPcmBuffer, SILENCE_FALLBACK_MS };
