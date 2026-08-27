const { SEVERITY } = require("./severityClassifier");
const { forwardActivityEvent } = require("./sources/activityEventAdapter");
const logger = require("../logs/logger");

// docFiles/L2-05 §5: "Client browser signals -> tab switch / visibility
// change, where available." Tab-visibility only in this pass — inactivity
// (no mouse/keyboard for N seconds) is deliberately not built yet: unlike
// visibility change, it has real false-positive risk (a candidate reading or
// thinking without moving the mouse) and needs a product-chosen threshold,
// not a developer-picked one.
const KNOWN_EVENT_TYPES = new Set(["TAB_HIDDEN", "TAB_VISIBLE"]);

// TAB_VISIBLE (the recovery signal) is INFORMATIONAL so it never adds to the
// integrity-score penalty — same role FACE_PRESENT plays in
// face-tracking/severityClassifier.js.
function classifySeverity(eventType) {
  return eventType === "TAB_HIDDEN" ? SEVERITY.WARNING : SEVERITY.INFORMATIONAL;
}

// Mirrors face-tracking/faceTrackingService.js's handleFaceEvent shape:
// validate the known vocabulary, classify, forward to Proctoring.
async function handleActivityEvent(io, sessionId, payload) {
  const eventType = payload && payload.eventType;
  if (!KNOWN_EVENT_TYPES.has(eventType)) {
    logger.warn(`activity.status: unknown eventType "${eventType}" sessionId=${sessionId}`);
    return;
  }

  const durationSeconds = typeof (payload && payload.durationSeconds) === "number" ? payload.durationSeconds : null;
  const durationMs = durationSeconds !== null ? Math.round(durationSeconds * 1000) : null;
  const severity = classifySeverity(eventType);

  await forwardActivityEvent(io, sessionId, { eventType, severity, durationMs });
}

module.exports = { handleActivityEvent, KNOWN_EVENT_TYPES };
