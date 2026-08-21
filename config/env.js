const dotenv = require("dotenv");
dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.warn(`⚠️  Missing env var ${name} — service will fail at the point it's used`);
  }
  return value;
}

module.exports = {
  port: process.env.PORT || 4001,
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",

  db: {
    server: required("DB_SERVER"),
    port: Number(process.env.DB_PORT) || 1433,
    database: required("DB_DATABASE"),
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
  },

  redis: {
    host: required("REDIS_HOST"),
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_TLS === "true" ? {} : undefined,
    keyPrefix: process.env.REDIS_PREFIX || "interview:",
  },

  jwtInterviewAccessTokenSecretKey: required("JWT_INTERVIEW_ACCESS_TOKEN_SECRET_KEY"),

  // Shared secret for the practywiz-backend -> ai-interview-backend
  // server-to-server call (POST /api/sessions). Same value must be set in
  // practywiz-backend's env as INTERNAL_SERVICE_KEY.
  internalServiceKey: required("INTERNAL_SERVICE_KEY"),

  reconnectGracePeriodMs: Number(process.env.RECONNECT_GRACE_PERIOD_MS) || 120000,

  elevenLabs: {
    apiKey: required("ELEVENLABS_API_KEY"),
    sttModelId: process.env.ELEVENLABS_STT_MODEL_ID || "scribe_v1",
    ttsVoiceId: required("ELEVENLABS_TTS_VOICE_ID"),
    ttsModelId: process.env.ELEVENLABS_TTS_MODEL_ID || "eleven_turbo_v2_5",
  },

  openai: {
    apiKey: required("OPENAI_API_KEY"),
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  },
};
