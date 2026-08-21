const redis = require("../config/redis");
const sessionRepository = require("../session/sessionRepository");
const { CHECK_TYPES, THRESHOLDS } = require("./readinessConfig");

const READINESS_TTL_SECONDS = 30 * 60;

function readinessKey(sessionId) {
  return `readiness:${sessionId}`;
}

// Each check is evaluated against its own configured threshold and returns a
// specific, actionable reason on failure — never just "failed" — so the
// frontend can turn it into corrective guidance.
function evaluate(checkType, measurement = {}) {
  switch (checkType) {
    case "CAMERA": {
      const { width, height } = measurement;
      if (!width || !height) {
        return { status: "FAIL", reason: "No camera frame detected. Check camera permission and that no other app is using it." };
      }
      return { status: "PASS", reason: null };
    }
    case "LIGHTING": {
      const { avgLuminance } = measurement;
      if (typeof avgLuminance !== "number") {
        return { status: "FAIL", reason: "Unable to read lighting from the camera." };
      }
      if (avgLuminance < THRESHOLDS.MIN_LUMINANCE) {
        return { status: "FAIL", reason: "Too dark. Move to a brighter area or face a light source." };
      }
      if (avgLuminance > THRESHOLDS.MAX_LUMINANCE) {
        return { status: "FAIL", reason: "Too bright / overexposed. Reduce backlight or direct light on the camera." };
      }
      return { status: "PASS", reason: null };
    }
    case "VOICE": {
      const { peakRms } = measurement;
      if (typeof peakRms !== "number" || peakRms < THRESHOLDS.MIN_VOICE_RMS) {
        return { status: "FAIL", reason: "Microphone volume too low. Check mic permission/selection and speak normally." };
      }
      return { status: "PASS", reason: null };
    }
    case "NETWORK": {
      const { latencyMs } = measurement;
      if (typeof latencyMs !== "number" || latencyMs > THRESHOLDS.MAX_LATENCY_MS) {
        return { status: "FAIL", reason: "Connection too slow/unstable. Move closer to your router or switch networks." };
      }
      return { status: "PASS", reason: null };
    }
    default:
      return { status: "FAIL", reason: "Unknown check type." };
  }
}

async function reportCheck(sessionId, checkType, measurement) {
  if (!CHECK_TYPES.includes(checkType)) {
    return { checkType, status: "FAIL", reason: "Unknown check type." };
  }

  const result = evaluate(checkType, measurement);
  const record = { ...result, checkedAt: new Date().toISOString() };

  await redis.hset(readinessKey(sessionId), checkType, JSON.stringify(record));
  await redis.expire(readinessKey(sessionId), READINESS_TTL_SECONDS);

  const status = await getStatus(sessionId);
  if (status.overallReady) {
    sessionRepository.markSessionReady(sessionId); // fire-and-forget
  }

  return { checkType, ...result };
}

async function getStatus(sessionId) {
  const raw = await redis.hgetall(readinessKey(sessionId));
  const checks = {};
  for (const checkType of CHECK_TYPES) {
    checks[checkType] = raw[checkType] ? JSON.parse(raw[checkType]) : { status: "PENDING", reason: null };
  }
  const overallReady = CHECK_TYPES.every((checkType) => checks[checkType].status === "PASS");
  return { checks, overallReady };
}

module.exports = { reportCheck, getStatus };
