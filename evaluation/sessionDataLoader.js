const { getPool, sql } = require("../config/database");
const sessionRepository = require("../session/sessionRepository");
const codingSubmissionRepository = require("../coding/codingSubmissionRepository");
const proctoringEventRepository = require("../proctoring/proctoringEventRepository");

// docFiles/L3-01..L3-05: Layer 3 reads ONLY already-persisted SQL data, never
// live Redis session state (session/sessionStore.js is deleted entirely on
// endSession — nothing there survives past session end). This is the single
// place that loads everything a report needs, so every evaluation/ module
// downstream works off one consistent snapshot instead of re-querying.
//
// Unlike the hot-path repositories elsewhere in this codebase (which swallow
// errors so a live interview is never broken by a logging failure), this
// module intentionally lets query errors propagate — there is no live loop
// left to protect once a session has ended, and evaluationPipeline.js's
// single top-level catch is what turns a thrown error here into a `FAILED`
// report status instead of a silently stuck `GENERATING` one.

async function fetchSessionRow(sessionId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query(`
      SELECT id, candidate_id AS candidateId, interview_id AS interviewId, status,
             started_at AS startedAt, ended_at AS endedAt, completion_reason AS completionReason
      FROM dbo.interview_sessions
      WHERE id = @sessionId
    `);
  return result.recordset[0] || null;
}

async function fetchCandidateRow(candidateId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("candidateId", sql.Int, candidateId)
    .query(`SELECT id, name, email FROM dbo.interview_candidates WHERE id = @candidateId`);
  return result.recordset[0] || null;
}

async function fetchQuestionsAsked(sessionId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query(`
      SELECT id, section, sequence, question_text AS questionText, is_followup AS isFollowUp,
             parent_question_id AS parentQuestionId, asked_at AS askedAt, completed_at AS completedAt,
             interaction_type AS interactionType, options, correct_option AS correctOption,
             selected_option AS selectedOption
      FROM dbo.interview_questions_asked
      WHERE session_id = @sessionId
      ORDER BY sequence ASC
    `);
  return result.recordset.map((row) => ({
    ...row,
    isFollowUp: Boolean(row.isFollowUp),
    options: row.options ? JSON.parse(row.options) : null,
  }));
}

async function fetchTranscripts(sessionId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query(`
      SELECT id, speaker, sequence, transcript, [timestamp]
      FROM dbo.interview_transcripts
      WHERE session_id = @sessionId
      ORDER BY sequence ASC
    `);
  return result.recordset;
}

async function fetchCodingSubmissions(sessionId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query(`
      SELECT id, sequence, problem_statement AS problemStatement, language, code, evaluation, submitted_at AS submittedAt
      FROM dbo.interview_coding_submissions
      WHERE session_id = @sessionId
      ORDER BY sequence ASC
    `);
  return result.recordset.map((row) => ({
    ...row,
    evaluation: row.evaluation ? JSON.parse(row.evaluation) : null,
  }));
}

// Loads everything a report needs for one session, in one place. Throws if
// the session doesn't exist or hasn't actually completed — a report must
// never be generated from a live/in-progress session.
async function loadSessionData(sessionId) {
  const session = await fetchSessionRow(sessionId);
  if (!session) throw new Error(`session not found: ${sessionId}`);
  if (session.status !== "COMPLETED") {
    throw new Error(`session ${sessionId} is not COMPLETED (status=${session.status}) — refusing to evaluate`);
  }

  const [candidate, questionsAsked, transcripts, codingSubmissions, proctoringEvents, sessionContext] =
    await Promise.all([
      fetchCandidateRow(session.candidateId),
      fetchQuestionsAsked(sessionId),
      fetchTranscripts(sessionId),
      fetchCodingSubmissions(sessionId),
      proctoringEventRepository.fetchProctoringEvents(sessionId),
      sessionRepository.fetchSessionContext(sessionId),
    ]);

  return {
    session,
    candidate,
    questionsAsked,
    transcripts,
    codingSubmissions,
    proctoringEvents,
    // contextSnapshot's shape comes from jd-resume/contextBuilder.js's
    // buildResumeContext (skills/experience_claims/role_requirements/
    // knowledge_areas/question_targets) — read defensively since this
    // module doesn't guarantee that shape; skillResultAggregator.js falls
    // back to grouping by section if `skills` isn't a usable array.
    skillLabels: Array.isArray(sessionContext?.contextSnapshot?.skills)
      ? sessionContext.contextSnapshot.skills
      : [],
  };
}

module.exports = { loadSessionData };
