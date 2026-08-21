const crypto = require("crypto");
const sessionStore = require("../session/sessionStore");
const sessionRepository = require("../session/sessionRepository");

const EVENT_NAME = "interview:event";

// Mapping to 03-LIVE-INTERVIEW-MODULE.md §3's Master Event Registry naming,
// where this codebase's already-shipped wire format differs cosmetically.
// Left as-is rather than renamed — nothing gains from churning a working,
// verified event contract for a naming-only difference:
//   face.status         <-> doc's face.event
//   payload.eventType    <-> doc's payload.type   (face.status, proctoring.event)
//   proctoring.event payload otherwise matches doc's {type, severity, timestamp} shape

// Builds and broadcasts the doc-specified event envelope
// ({eventId, sessionId, type, timestamp, sequence, payload}) to everyone in
// the session's Socket.IO room, and fires an async audit write.
async function emitEnvelope(io, sessionId, type, payload) {
  const sequence = await sessionStore.nextSequence(sessionId);
  const envelope = {
    eventId: crypto.randomUUID(),
    sessionId,
    type,
    timestamp: new Date().toISOString(),
    sequence,
    payload: payload || {},
  };

  io.to(sessionId).emit(EVENT_NAME, envelope);
  sessionRepository.insertSessionEventRow(envelope, "server"); // fire-and-forget
  return envelope;
}

module.exports = { EVENT_NAME, emitEnvelope };
