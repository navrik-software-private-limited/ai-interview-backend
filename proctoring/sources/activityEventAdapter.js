const proctoringService = require("../proctoringService");

// docFiles/L2-05 §6's suggested sources/activity-monitor.js — thin
// pass-through, same shape as sources/faceEventAdapter.js.
async function forwardActivityEvent(io, sessionId, { eventType, severity, durationMs = null, metadata = null }) {
  return proctoringService.recordEvent(io, sessionId, {
    source: "activity-monitor",
    eventType,
    severity,
    durationMs,
    metadata,
  });
}

module.exports = { forwardActivityEvent };
