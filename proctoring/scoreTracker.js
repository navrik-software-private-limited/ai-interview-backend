const redis = require("../config/redis");
const { SEVERITY } = require("./severityClassifier");

const SCORE_TTL_SECONDS = 6 * 60 * 60; // matches session/sessionStore.js's session TTL
const STARTING_SCORE = 100;

// Same underlying evidence the end-of-session summary reads (proctoring_events),
// just surfaced incrementally as a single running number. Purely observational —
// per 03-LIVE-INTERVIEW-MODULE.md §5, proctoring never ends or fails a session
// on its own, and this tracker has no path to session lifecycle at all.
const PENALTY_BY_SEVERITY = {
  [SEVERITY.INFORMATIONAL]: 1,
  [SEVERITY.WARNING]: 3,
  [SEVERITY.SUSPICIOUS]: 7,
  [SEVERITY.CRITICAL]: 15,
};

function scoreKey(sessionId) {
  return `proctoring:score:${sessionId}`;
}

async function applyEvent(sessionId, severity) {
  const penalty = PENALTY_BY_SEVERITY[severity] || 0;
  const raw = await redis.get(scoreKey(sessionId));
  const current = raw !== null ? Number(raw) : STARTING_SCORE;
  const next = Math.max(0, Math.min(100, current - penalty));
  await redis.set(scoreKey(sessionId), String(next), "EX", SCORE_TTL_SECONDS);
  return next;
}

module.exports = { applyEvent };
