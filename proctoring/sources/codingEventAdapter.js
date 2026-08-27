const proctoringService = require("../proctoringService");

// doc 04 §5 "Coding activity" input / docFiles/L2-05 §5 "Coding module ->
// unusual coding environment events" — thin pass-through, same shape as
// sources/faceEventAdapter.js.
async function forwardCodingEvent(io, sessionId, { eventType, severity, metadata = null }) {
  return proctoringService.recordEvent(io, sessionId, {
    source: "coding-environment",
    eventType,
    severity,
    metadata,
  });
}

module.exports = { forwardCodingEvent };
