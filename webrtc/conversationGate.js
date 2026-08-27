const turnMetrics = require("../interviewer/turnMetrics");

// Half-duplex turn gate. Without this, the candidate's mic (picking up
// speaker bleed/echo of the AI's own voice, or just background noise) keeps
// getting fed into the VAD *while the AI is speaking*, which can trigger a
// second reply before the first has finished playing — two playback calls
// pushing audio onto the same outbound track at once, which is what sounds
// like "the AI's voice going noisy/interfered with another voice".
//
// In-memory (not Redis) because this is read on every ~10ms inbound audio
// frame — it must be synchronous and fast, not a network round-trip.
//
// doc/real_time_interview_communication_improvement.md Phase 3 (barge-in):
// this grew from a plain boolean into per-session turn tracking. Every
// caller that eventually needs to "let go" of the gate — including a
// setTimeout-delayed release, or an LLM/TTS call that was already in flight
// when a barge-in happened — captures the turnId it started with and that
// exact value is checked again before anything is actually cleared. A stale
// caller (superseded by a newer turn) is always a safe no-op, never a
// corruption of the new turn's state. This turnId-gating is the one
// correctness mechanism this whole file exists to provide; everything else
// (AbortController, turnMetrics) hangs off it.

const sessions = new Map(); // sessionId -> { turnId, controller: AbortController }
// Deliberately separate from `sessions` above, and never touched by
// interrupt()/releaseAiBusy() — only setAiBusy() advances it and only
// clearSession() resets it. turnId has to stay monotonic *across* an
// interrupt, not just within one uninterrupted turn: interrupt() deletes
// the `sessions` entry immediately so a brand new turn can start right
// away, and if turnId were derived from that entry it would restart at 1
// too — a stale delayed releaseAiBusy() call from the just-interrupted
// turn could then collide with the new turn's turnId and incorrectly
// release it.
const turnCounters = new Map(); // sessionId -> last turnId issued

function setAiBusy(sessionId) {
  const turnId = (turnCounters.get(sessionId) || 0) + 1;
  turnCounters.set(sessionId, turnId);
  const controller = new AbortController();
  sessions.set(sessionId, { turnId, controller });
  return { turnId };
}

// Releases the gate after a short delay rather than immediately, so the
// room's echo/reverb tail from the AI's own speech has time to decay before
// the candidate's mic is "believed" again. turnId must be the value
// returned by the setAiBusy() call this is releasing — if a newer turn has
// since taken over (e.g. a barge-in), this is a no-op; the newer turn's
// state is left alone.
const RELEASE_DELAY_MS = 400;
function releaseAiBusy(sessionId, turnId, delayMs = RELEASE_DELAY_MS) {
  setTimeout(() => {
    const turn = sessions.get(sessionId);
    if (turn && turn.turnId === turnId) sessions.delete(sessionId);
  }, delayMs);
}

function isAiBusy(sessionId) {
  return sessions.has(sessionId);
}

// Returns the *current* turn's AbortSignal — read once by a caller (e.g.
// interviewController.js's speak(), right before it starts an LLM/TTS call)
// and kept as a local reference from that point on, not re-read later. By
// the time a later catch block runs, a barge-in may already have moved the
// session on to a newer turn with its own fresh, non-aborted signal — only
// the originally-captured reference correctly reflects whether THIS call
// was the one that got cancelled.
function getSignal(sessionId) {
  const turn = sessions.get(sessionId);
  return turn ? turn.controller.signal : undefined;
}

function getTurnId(sessionId) {
  const turn = sessions.get(sessionId);
  return turn ? turn.turnId : undefined;
}

function isCurrentTurn(sessionId, turnId) {
  const turn = sessions.get(sessionId);
  return Boolean(turn && turn.turnId === turnId);
}

// doc Phase 3 barge-in entry point. Finalizes the turn being cancelled
// (marks + logs its turn-metrics record, including how long the interrupt
// itself took) and aborts its in-flight LLM/TTS call, then hands the gate
// back — the caller (webrtc/audioInbound.js) is expected to immediately
// start a new turn for the candidate's own speech right after this returns.
// Unlike releaseAiBusy, this is an intentional override: it always acts on
// whatever turn is current, no turnId check, since interrupting *is* the
// legitimate reason to supersede it.
function interrupt(sessionId) {
  const turn = sessions.get(sessionId);
  if (!turn) return false;

  turnMetrics.mark(sessionId, "interruptStart");
  turn.controller.abort();
  turnMetrics.mark(sessionId, "aiPlaybackStopped");
  turnMetrics.finish(sessionId);
  sessions.delete(sessionId);
  return true;
}

function clearSession(sessionId) {
  const turn = sessions.get(sessionId);
  if (turn) turn.controller.abort();
  sessions.delete(sessionId);
  turnCounters.delete(sessionId);
}

module.exports = {
  setAiBusy,
  releaseAiBusy,
  isAiBusy,
  getSignal,
  getTurnId,
  isCurrentTurn,
  interrupt,
  clearSession,
};
