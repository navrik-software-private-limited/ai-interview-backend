// 06-READINESS-CHECK-MODULE.md — configurable pass/fail thresholds, not
// hardcoded product rules (same framing as question-engine/sectionPlan.js).
// Env-overridable so a deployment can tune these without a code change.

const CHECK_TYPES = ["CAMERA", "LIGHTING", "VOICE", "NETWORK"];

const THRESHOLDS = {
  // 0-255 average luminance sampled from a video frame. Below MIN = too dark
  // to reliably see the candidate; above MAX = blown out / overexposed.
  MIN_LUMINANCE: Number(process.env.READINESS_MIN_LUMINANCE) || 60,
  MAX_LUMINANCE: Number(process.env.READINESS_MAX_LUMINANCE) || 235,
  // Peak RMS amplitude (0-1 scale) while the candidate speaks a short phrase.
  MIN_VOICE_RMS: Number(process.env.READINESS_MIN_VOICE_RMS) || 0.02,
  // Round-trip latency to this service, generous default for varied
  // home connections.
  MAX_LATENCY_MS: Number(process.env.READINESS_MAX_LATENCY_MS) || 1200,
};

module.exports = { CHECK_TYPES, THRESHOLDS };
