const sessionStore = require("../session/sessionStore");
const { emitEnvelope } = require("../communication/envelope");
const faceEventRepository = require("./faceEventRepository");
const { classifySeverity, shouldForwardToProctoring } = require("./severityClassifier");
const { forwardFaceEvent } = require("../proctoring/sources/faceEventAdapter");
const logger = require("../logs/logger");

// doc 04 §4 §2 — the fixed tracked-event vocabulary. Anything else is
// rejected rather than silently persisted with an unclassifiable severity.
const KNOWN_EVENT_TYPES = new Set([
  "FACE_PRESENT",
  "FACE_NOT_DETECTED",
  "MULTIPLE_FACES",
  "FACE_POSITION_CHANGED",
  "CAMERA_BLOCKED",
]);

// doc 04 §4 §4 processing flow: receive (already debounced client-side) ->
// classify severity -> persist as FaceEvent -> emit face.status (which also
// doubles as the "emit corresponding SessionEvent" step, since emitEnvelope
// auto-persists to interview_session_events) -> escalate to Proctoring if
// severity >= WARNING.
async function handleFaceEvent(io, sessionId, payload) {
  const eventType = payload && payload.eventType;
  if (!KNOWN_EVENT_TYPES.has(eventType)) {
    logger.warn(`face.status: unknown eventType "${eventType}" sessionId=${sessionId}`);
    return;
  }

  const durationSeconds = typeof (payload && payload.durationSeconds) === "number" ? payload.durationSeconds : null;
  const confidence = typeof (payload && payload.confidence) === "number" ? payload.confidence : null;
  const metadata = (payload && payload.metadata) || null;

  // doc §3: "repeated FACE_NOT_DETECTED" escalates WARNING -> SUSPICIOUS.
  // Tracked as a monotonic per-session counter (never reset on recovery) —
  // a candidate who repeatedly drifts out of frame across the whole
  // interview is exactly the pattern this is meant to catch.
  let notDetectedCountInSession = 0;
  if (eventType === "FACE_NOT_DETECTED") {
    const session = await sessionStore.getSession(sessionId);
    notDetectedCountInSession = ((session && session.faceNotDetectedCount) || 0) + 1;
    await sessionStore.touchSession(sessionId, { faceNotDetectedCount: notDetectedCountInSession });
  }

  const severity = classifySeverity(eventType, { durationSeconds, notDetectedCountInSession });
  const durationMs = durationSeconds !== null ? Math.round(durationSeconds * 1000) : null;

  faceEventRepository.insertFaceEvent(sessionId, eventType, { severity, confidence, durationMs, metadata }); // fire-and-forget

  await emitEnvelope(io, sessionId, "face.status", {
    eventType,
    severity,
    durationSeconds,
    metadata: metadata || {},
  });

  if (shouldForwardToProctoring(severity)) {
    await forwardFaceEvent(io, sessionId, { eventType, severity, confidence, durationMs, metadata });
  }
}

module.exports = { handleFaceEvent };
