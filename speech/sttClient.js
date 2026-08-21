const axios = require("axios");
const FormData = require("form-data");
const env = require("../config/env");
const { pcmToWav } = require("./wav");
const logger = require("../logs/logger");

// ElevenLabs Speech-to-Text (batch/REST): POST /v1/speech-to-text,
// multipart form with model_id + file, sync JSON response with `.text`.
async function transcribeUtterance(pcmInt16Buffer, sampleRate) {
  if (!env.elevenLabs.apiKey) {
    logger.warn("ELEVENLABS_API_KEY not set — using mock transcript instead of real STT");
    return "[mock transcript — ELEVENLABS_API_KEY not configured]";
  }

  const wavBuffer = pcmToWav(pcmInt16Buffer, sampleRate, 1, 16);

  const form = new FormData();
  form.append("model_id", env.elevenLabs.sttModelId);
  form.append("file", wavBuffer, { filename: "utterance.wav", contentType: "audio/wav" });

  const res = await axios.post("https://api.elevenlabs.io/v1/speech-to-text", form, {
    headers: { ...form.getHeaders(), "xi-api-key": env.elevenLabs.apiKey },
    maxBodyLength: Infinity,
  });

  return (res.data && res.data.text) || "";
}

module.exports = { transcribeUtterance };
