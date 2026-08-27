const logger = require("../logs/logger");

// doc/real_time_interview_communication_improvement.md §18/Phase 1: per-turn
// latency correlation. Session-keyed module-level state, same pattern as
// webrtc/conversationGate.js — no object threading through call signatures,
// every call site stays a one-line addition (mark(sessionId, label)).
//
// responseId here is log-correlation ONLY for this phase — it is not yet
// used to discard stale/interrupted audio. That wiring is Phase 4
// (Add Response IDs) in the improvement doc; introducing it now, unused,
// would be exactly the "change behavior unnecessarily" Phase 1 is told not
// to do.
const activeTurns = new Map(); // sessionId -> { responseId, sessionId, startedAt, order: [], marks: {} }
const turnCounters = new Map(); // sessionId -> last responseId sequence number

function startTurn(sessionId) {
  const n = (turnCounters.get(sessionId) || 0) + 1;
  turnCounters.set(sessionId, n);
  const turn = {
    responseId: `${sessionId}:${n}`,
    sessionId,
    startedAt: Date.now(),
    order: [],
    marks: {},
  };
  activeTurns.set(sessionId, turn);
  return turn;
}

// Safe no-op with no active turn — lets shared call sites (speak() is used
// for the greeting and static section-transition lines too, neither of
// which follows a candidate utterance) call this unconditionally rather
// than checking "is there a turn?" everywhere first. Also a safe no-op for a
// repeated label (e.g. ttsFirstAudio would otherwise fire once per streamed
// chunk) — only the first occurrence of a label is meaningful.
function mark(sessionId, label) {
  const turn = activeTurns.get(sessionId);
  if (!turn || turn.marks[label] !== undefined) return;
  turn.marks[label] = Date.now();
  turn.order.push(label);
}

// Logs one structured line with every mark's offset from turn start and the
// delta from the previous mark, then clears the turn. No candidate audio or
// transcript text is ever recorded here — timestamps and labels only,
// matching this doc's own "production-safe, no sensitive data" instruction.
function finish(sessionId) {
  const turn = activeTurns.get(sessionId);
  if (!turn) return null;
  activeTurns.delete(sessionId);

  let previous = turn.startedAt;
  const marks = turn.order.map((label) => {
    const at = turn.marks[label];
    const entry = { label, offsetMs: at - turn.startedAt, deltaMs: at - previous };
    previous = at;
    return entry;
  });

  const record = { responseId: turn.responseId, sessionId, totalMs: previous - turn.startedAt, marks };
  logger.info(`turn-metrics ${JSON.stringify(record)}`);
  return record;
}

module.exports = { startTurn, mark, finish };
