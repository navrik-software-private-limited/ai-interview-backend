const faceSeverityClassifier = require("../face-tracking/severityClassifier");

// L2-05-proctoring-module.md §4 uses a differently-labeled severity scale
// (INFO/WARNING/MEDIUM/HIGH) than what's already built and persisted for
// Face Tracking (doc 04 §4 §3: INFORMATIONAL/WARNING/SUSPICIOUS/CRITICAL).
// Kept the existing 4-tier vocabulary here rather than rename what's already
// shipped — L2-05's labels map onto it 1:1 in spirit:
//   INFO <-> INFORMATIONAL, WARNING <-> WARNING, MEDIUM <-> SUSPICIOUS, HIGH <-> CRITICAL
const { SEVERITY } = faceSeverityClassifier;

// L2-05 §7: "severity auto-classified if not provided" — the fallback used
// when a source (proctoring/sources/*) submits an event without a severity
// already attached. Face events already arrive pre-classified by
// face-tracking/severityClassifier.js (reused here for FACE_* types in case a
// source ever forwards one without pre-classifying it); any other/future
// event type defaults to WARNING rather than INFORMATIONAL — proctoring
// evidence should err toward visibility, never silently minimized.
function classifyFallback(eventType, context = {}) {
  if (typeof faceSeverityClassifier.classifySeverity === "function") {
    try {
      const known = ["FACE_PRESENT", "FACE_NOT_DETECTED", "MULTIPLE_FACES", "FACE_POSITION_CHANGED", "CAMERA_BLOCKED"];
      if (known.includes(eventType)) {
        return faceSeverityClassifier.classifySeverity(eventType, context);
      }
    } catch (err) {
      // fall through to default
    }
  }
  return SEVERITY.WARNING;
}

module.exports = { SEVERITY, classifyFallback };
