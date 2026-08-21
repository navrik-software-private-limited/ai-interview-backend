const redis = require("../config/redis");

const SESSION_TTL_SECONDS = 6 * 60 * 60; // 6h

function sessionKey(sessionId) {
  return `session:${sessionId}`;
}

function seqKey(sessionId) {
  return `session:${sessionId}:seq`;
}

async function createOrResumeSession(sessionId, { candidateId, interviewId }) {
  const existing = await redis.get(sessionKey(sessionId));
  if (existing) {
    const parsed = JSON.parse(existing);
    parsed.status = "ACTIVE";
    parsed.lastSeenAt = new Date().toISOString();
    await redis.set(sessionKey(sessionId), JSON.stringify(parsed), "EX", SESSION_TTL_SECONDS);
    return { session: parsed, resumed: true };
  }

  const session = {
    sessionId,
    candidateId,
    interviewId,
    status: "ACTIVE",
    connectionId: null,
    lastSeenAt: new Date().toISOString(),
    conversationHistory: [],
    // Question Engine state (doc 04 §2) — advanced via the generic
    // touchSession(sessionId, patch) merge, no dedicated setters needed.
    // The one-follow-up-per-question cap falls out naturally from
    // currentQuestionIsFollowUp: once the tracked question IS a follow-up,
    // answering it advances straight on rather than asking the decider again.
    currentSection: "INTRO",
    questionsAskedInSection: 0,
    currentQuestionAskedId: null,
    currentQuestionIsFollowUp: false,
    currentQuestionText: null,
    // doc 04 §4 (Face Tracking) — monotonic count of FACE_NOT_DETECTED events
    // this session has seen, used to escalate WARNING -> SUSPICIOUS on repeats.
    faceNotDetectedCount: 0,
    // 03-LIVE-INTERVIEW-MODULE.md §8: true only while the CASE section has
    // presented its content and is waiting on case.acknowledged — the hard
    // gate that blocks case questions from starting. See case-study/caseFlowController.js.
    awaitingCaseAcknowledgement: false,
    // 03-LIVE-INTERVIEW-MODULE.md §9 — the problem the candidate is currently
    // working on (null between problems / outside CODING), and titles already
    // asked this session (best-effort duplicate avoidance for problem 2).
    currentCodingProblem: null,
    codingProblemTitles: [],
    // Interview Module – Bug, Gap & UI/UX Improvements.md §1 — loaded once by
    // interviewController.js's startInterview from the active
    // dbo.interview_configurations row; null means "use sectionPlan.js's
    // hardcoded defaults" (no active configuration, or it failed to load).
    sectionOrder: null,
    sectionTargets: null,
    // Interview Room MCQ interaction type — {[sectionName]: {interactionType,
    // mcqCount}}, loaded once by interviewController.js's loadSectionConfig
    // alongside sectionOrder/sectionTargets. Null (or a section missing from
    // this map) means "use question-engine/interactionTypePlan.js's
    // hardcoded defaults" — same never-breaks-on-missing-config pattern.
    sectionInteraction: null,
  };
  await redis.set(sessionKey(sessionId), JSON.stringify(session), "EX", SESSION_TTL_SECONDS);
  return { session, resumed: false };
}

async function touchSession(sessionId, patch = {}) {
  const raw = await redis.get(sessionKey(sessionId));
  if (!raw) return null;
  const session = { ...JSON.parse(raw), ...patch, lastSeenAt: new Date().toISOString() };
  await redis.set(sessionKey(sessionId), JSON.stringify(session), "EX", SESSION_TTL_SECONDS);
  return session;
}

async function getSession(sessionId) {
  const raw = await redis.get(sessionKey(sessionId));
  return raw ? JSON.parse(raw) : null;
}

async function endSession(sessionId) {
  await redis.del(sessionKey(sessionId));
  await redis.del(seqKey(sessionId));
}

async function nextSequence(sessionId) {
  return redis.incr(seqKey(sessionId));
}

async function appendHistory(sessionId, message) {
  const session = await getSession(sessionId);
  if (!session) return;
  session.conversationHistory = [...(session.conversationHistory || []), message];
  await redis.set(sessionKey(sessionId), JSON.stringify(session), "EX", SESSION_TTL_SECONDS);
}

async function getHistory(sessionId) {
  const session = await getSession(sessionId);
  return session ? session.conversationHistory || [] : [];
}

module.exports = {
  createOrResumeSession,
  touchSession,
  getSession,
  endSession,
  nextSequence,
  appendHistory,
  getHistory,
};
