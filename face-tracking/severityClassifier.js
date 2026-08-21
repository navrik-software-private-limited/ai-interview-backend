// doc 04 §4 (Face Tracking Module) §3 — severity classification. Pure
// function so the Proctoring module (doc 04 §5, not built yet) can later
// reuse the exact same rules rather than re-deriving them.
const SEVERITY = {
  INFORMATIONAL: "INFORMATIONAL",
  WARNING: "WARNING",
  SUSPICIOUS: "SUSPICIOUS",
  CRITICAL: "CRITICAL",
};

// A session that has already seen this many FACE_NOT_DETECTED events
// escalates from a brief WARNING to a repeated-pattern SUSPICIOUS.
const REPEATED_NOT_DETECTED_THRESHOLD = 3;

// A CAMERA_BLOCKED that has lasted at least this long counts as "sustained".
const SUSTAINED_CAMERA_BLOCKED_SECONDS = 5;

function classifySeverity(eventType, { durationSeconds = null, notDetectedCountInSession = 0 } = {}) {
  switch (eventType) {
    case "FACE_POSITION_CHANGED":
    case "FACE_PRESENT":
      return SEVERITY.INFORMATIONAL;
    case "FACE_NOT_DETECTED":
      return notDetectedCountInSession >= REPEATED_NOT_DETECTED_THRESHOLD ? SEVERITY.SUSPICIOUS : SEVERITY.WARNING;
    case "MULTIPLE_FACES":
      return SEVERITY.CRITICAL;
    case "CAMERA_BLOCKED":
      return durationSeconds !== null && durationSeconds >= SUSTAINED_CAMERA_BLOCKED_SECONDS
        ? SEVERITY.CRITICAL
        : SEVERITY.WARNING;
    default:
      return SEVERITY.INFORMATIONAL;
  }
}

// Escalation threshold for forwarding to the Proctoring module (doc 04 §4 §4
// flow: "If severity >= WARNING -> forward to Proctoring module").
function shouldForwardToProctoring(severity) {
  return severity !== SEVERITY.INFORMATIONAL;
}

module.exports = { SEVERITY, classifySeverity, shouldForwardToProctoring };
