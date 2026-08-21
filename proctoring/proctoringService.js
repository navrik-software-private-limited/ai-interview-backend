const { emitEnvelope } = require("../communication/envelope");
const proctoringEventRepository = require("./proctoringEventRepository");
const { classifyFallback, SEVERITY } = require("./severityClassifier");
const scoreTracker = require("./scoreTracker");
const logger = require("../logs/logger");

// docFiles/L2-05-proctoring-module.md — the central ingest point every
// proctoring source (currently just proctoring/sources/faceEventAdapter.js;
// connectivity/activity/coding sources are documented but not built yet)
// funnels through. Design rule from that doc, honored here: this module only
// records structured evidence — it never auto-fails or auto-flags a
// candidate, and never blocks/terminates the interview.
//
// Emits doc 04's `proctoring.event` (mirrors L2-05's PROCTORING_EVENT) always,
// plus `proctoring.warning` (mirrors PROCTORING_WARNING) whenever the
// resolved severity is anything above INFORMATIONAL.
async function recordEvent(io, sessionId, { source, eventType, severity = null, confidence = null, durationMs = null, metadata = null }) {
  const resolvedSeverity = severity || classifyFallback(eventType, { durationSeconds: durationMs !== null ? durationMs / 1000 : null });

  proctoringEventRepository.insertProctoringEvent(sessionId, eventType, {
    severity: resolvedSeverity,
    confidence,
    durationMs,
    evidence: metadata,
  }); // fire-and-forget

  await emitEnvelope(io, sessionId, "proctoring.event", {
    source,
    eventType,
    severity: resolvedSeverity,
    metadata: metadata || {},
  });

  // proctoring.score: same evidence the end-of-session summary uses, surfaced
  // incrementally. Never gates or ends the session — see scoreTracker.js.
  const score = await scoreTracker.applyEvent(sessionId, resolvedSeverity);
  await emitEnvelope(io, sessionId, "proctoring.score", { score, severity: resolvedSeverity });

  if (resolvedSeverity !== SEVERITY.INFORMATIONAL) {
    await emitEnvelope(io, sessionId, "proctoring.warning", {
      source,
      eventType,
      severity: resolvedSeverity,
    });
  }

  logger.info(`proctoring.event source=${source} type=${eventType} severity=${resolvedSeverity} sessionId=${sessionId}`);
  return resolvedSeverity;
}

module.exports = { recordEvent };
