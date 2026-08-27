const { SEVERITY } = require("./severityClassifier");
const { forwardCodingEvent } = require("./sources/codingEventAdapter");

// doc 04 §5 "Coding activity" / docFiles/L2-05 §5 "unusual coding
// environment events (if detectable)". Paste detection only in this pass —
// editor focus/blur is deliberately left out, since it would just duplicate
// the activity-monitor's tab-visibility signal for a candidate who alt-tabs
// while the coding panel happens to be open, without adding real new
// evidence.
//
// Thresholds are tunable defaults (same "configuration value, not a
// hard-coded product rule" spirit as question-engine/sectionPlan.js's
// SECTION_TARGETS), not a precisely-validated product decision.
const IGNORE_BELOW_CHARS = 15; // trivial pastes (a symbol, a short identifier) aren't meaningful evidence
const SUSPICIOUS_AT_CHARS = 150; // long enough to plausibly be a pasted solution, not a snippet

async function handlePasteEvent(io, sessionId, payload) {
  const charCount = payload && typeof payload.charCount === "number" ? payload.charCount : 0;
  if (charCount < IGNORE_BELOW_CHARS) return;

  const severity = charCount >= SUSPICIOUS_AT_CHARS ? SEVERITY.SUSPICIOUS : SEVERITY.WARNING;

  await forwardCodingEvent(io, sessionId, {
    eventType: "PASTE_DETECTED",
    severity,
    metadata: { charCount },
  });
}

module.exports = { handlePasteEvent, IGNORE_BELOW_CHARS, SUSPICIOUS_AT_CHARS };
