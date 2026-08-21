const proctoringService = require("../proctoringService");

// docFiles/L2-05-proctoring-module.md §6's suggested sources/face-event-adapter.js
// — thin pass-through so face-tracking/faceTrackingService.js doesn't need to
// know anything about the Proctoring module's internals, just that severity
// >= WARNING events get forwarded here.
async function forwardFaceEvent(io, sessionId, { eventType, severity, confidence = null, durationMs = null, metadata = null }) {
  return proctoringService.recordEvent(io, sessionId, {
    source: "face-tracking",
    eventType,
    severity,
    confidence,
    durationMs,
    metadata,
  });
}

module.exports = { forwardFaceEvent };
