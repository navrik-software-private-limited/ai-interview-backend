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
    // doc/real_time_interview_communication_improvement.md Phase 5: distinct
    // from sttModelId above — that one's for the existing batch REST
    // endpoint (speech/sttClient.js); this is ElevenLabs' realtime
    // WebSocket model, a different model family.
    sttRealtimeModelId: process.env.ELEVENLABS_STT_REALTIME_MODEL_ID || "scribe_v2_realtime",
    ttsVoiceId: required("ELEVENLABS_TTS_VOICE_ID"),
    ttsModelId: process.env.ELEVENLABS_TTS_MODEL_ID || "eleven_turbo_v2_5",
  },

  openai: {
    apiKey: required("OPENAI_API_KEY"),
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    // doc/real_time_interview_communication_improvement.md Phase 9 (§19 "LLM
    // timeout"): bounds every LLM call (single-shot invoke, initial stream
    // connect, and each stream chunk wait) so a hung request can never block
    // a turn indefinitely — previously unbounded.
    requestTimeoutMs: Number(process.env.OPENAI_REQUEST_TIMEOUT_MS) || 20000,
  },

  // doc/07_INTERVIEW_MODULE_STATUS_AND_ROADMAP.md gap #3: TURN is genuinely
  // optional (not required()'d) — an unset TURN_* is the valid default state
  // until a provider is chosen, not a startup error. STUN_URLS defaults to
  // the same public Google STUN server this service always hardcoded, so
  // leaving everything unset reproduces today's exact behavior.
  webrtc: {
    stunUrls: (process.env.STUN_URLS || "stun:stun.l.google.com:19302")
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean),
    turnUrls: (process.env.TURN_URLS || "")
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean),
    turnUsername: process.env.TURN_USERNAME || undefined,
    turnCredential: process.env.TURN_CREDENTIAL || undefined,
  },
};
