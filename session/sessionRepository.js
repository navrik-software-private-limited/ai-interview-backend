const crypto = require("crypto");
const { getPool, sql } = require("../config/database");
const logger = require("../logs/logger");

async function insertSessionEventRow(envelope, source) {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("sessionId", sql.UniqueIdentifier, envelope.sessionId)
      .input("eventId", sql.UniqueIdentifier, envelope.eventId)
      .input("sequence", sql.BigInt, envelope.sequence)
      .input("eventType", sql.VarChar, envelope.type)
      .input("source", sql.VarChar, source)
      .input("payload", sql.NVarChar, JSON.stringify(envelope.payload || {}))
      .input("occurredAt", sql.DateTime2, new Date(envelope.timestamp))
      .query(`
        INSERT INTO dbo.interview_session_events
          (id, session_id, event_id, sequence, event_type, source, payload, occurred_at)
        VALUES
          (NEWID(), @sessionId, @eventId, @sequence, @eventType, @source, @payload, @occurredAt)
      `);
  } catch (err) {
    // Audit write is best-effort — must never break the live interview loop.
    logger.warn("insertSessionEventRow failed:", err.message);
  }
}

async function insertTranscriptRow(sessionId, speaker, text) {
  try {
    const pool = await getPool();
    const seqResult = await pool
      .request()
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .query(`SELECT ISNULL(MAX(sequence), 0) + 1 AS nextSeq FROM dbo.interview_transcripts WHERE session_id = @sessionId`);
    const nextSeq = seqResult.recordset[0].nextSeq;

    await pool
      .request()
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .input("speaker", sql.VarChar, speaker)
      .input("sequence", sql.BigInt, nextSeq)
      .input("transcript", sql.NVarChar, text)
      .query(`
        INSERT INTO dbo.interview_transcripts (id, session_id, speaker, sequence, transcript, is_final)
        VALUES (NEWID(), @sessionId, @speaker, @sequence, @transcript, 1)
      `);
  } catch (err) {
    logger.warn("insertTranscriptRow failed:", err.message);
  }
}

// Session creation (POST /api/sessions — session/sessionCreationController.js).
// Mirrors practywiz-backend's insertInterviewSessionForCaseStudyQuery exactly
// (same table/columns) — ownership of the write just moves to this service.
async function insertInterviewSessionRow({ sessionId, candidateId, interviewId, caseStudyId, caseStudyPurchaseId }) {
  const pool = await getPool();
  await pool
    .request()
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .input("candidateId", sql.Int, candidateId)
    .input("interviewId", sql.UniqueIdentifier, interviewId)
    .input("caseStudyId", sql.Int, caseStudyId || null)
    .input("caseStudyPurchaseId", sql.Int, caseStudyPurchaseId || null)
    .query(`
      INSERT INTO dbo.interview_sessions
        (id, candidate_id, interview_id, case_study_id, case_study_purchase_id, status, current_section)
      VALUES
        (@sessionId, @candidateId, @interviewId, @caseStudyId, @caseStudyPurchaseId, 'CREATED', 'INTRO')
    `);
}

async function insertInterviewSessionContextRow(sessionId, { resumeReference, jdReference, contextSnapshot }) {
  const pool = await getPool();
  await pool
    .request()
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .input("resumeReference", sql.NVarChar, resumeReference || null)
    .input("jdReference", sql.NVarChar, jdReference || null)
    .input("contextSnapshot", sql.NVarChar, JSON.stringify(contextSnapshot || {}))
    .query(`
      INSERT INTO dbo.interview_session_context
        (id, session_id, resume_reference, jd_reference, interview_plan_version, context_snapshot)
      VALUES
        (NEWID(), @sessionId, @resumeReference, @jdReference, NULL, @contextSnapshot)
    `);
}

// doc 03 §7 (Session Logs): the one timeline event that happens before this
// service's own sequence counter (session/sessionStore.js's Redis INCR,
// always starting from 1) exists — fixed at sequence 0 so it sorts first.
// Mirrors practywiz-backend's insertSessionCreatedEventQuery, which this
// replaces now that session creation itself lives here.
async function insertSessionCreatedRow(sessionId, payload) {
  const pool = await getPool();
  await pool
    .request()
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .input("eventId", sql.UniqueIdentifier, crypto.randomUUID())
    .input("payload", sql.NVarChar, JSON.stringify(payload || {}))
    .query(`
      INSERT INTO dbo.interview_session_events
        (id, session_id, event_id, sequence, event_type, source, payload, occurred_at)
      VALUES
        (NEWID(), @sessionId, @eventId, 0, 'session.created', 'server', @payload, SYSUTCDATETIME())
    `);
}

// 06-READINESS-CHECK-MODULE.md (this repo's readiness/ module): CREATED ->
// READY_CHECK -> READY, gating whether the WS layer will accept a connection
// (see communication/socketServer.js's handleSessionConnect status check).
async function markSessionReady(sessionId) {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .query(`UPDATE dbo.interview_sessions SET status = 'READY', updated_at = SYSUTCDATETIME() WHERE id = @sessionId`);
  } catch (err) {
    logger.warn("markSessionReady failed:", err.message);
  }
}

async function fetchSessionStatus(sessionId) {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .query(`SELECT status FROM dbo.interview_sessions WHERE id = @sessionId`);
    return result.recordset[0] ? result.recordset[0].status : null;
  } catch (err) {
    logger.warn("fetchSessionStatus failed:", err.message);
    return null;
  }
}

async function markSessionActive(sessionId) {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .query(`UPDATE dbo.interview_sessions SET status = 'ACTIVE', updated_at = SYSUTCDATETIME() WHERE id = @sessionId`);
  } catch (err) {
    logger.warn("markSessionActive failed:", err.message);
  }
}

// 03-LIVE-INTERVIEW-MODULE.md §2.5/§11: ACTIVE -> COMPLETING -> COMPLETED.
// Persisted as its own transient status write, ahead of markSessionCompleted.
async function markSessionCompleting(sessionId) {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .query(`UPDATE dbo.interview_sessions SET status = 'COMPLETING', updated_at = SYSUTCDATETIME() WHERE id = @sessionId`);
  } catch (err) {
    logger.warn("markSessionCompleting failed:", err.message);
  }
}

async function markSessionCompleted(sessionId, reason) {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .input("reason", sql.VarChar, reason || "candidate_ended")
      .query(`
        UPDATE dbo.interview_sessions
        SET status = 'COMPLETED', ended_at = SYSUTCDATETIME(), completion_reason = @reason, updated_at = SYSUTCDATETIME()
        WHERE id = @sessionId
      `);
  } catch (err) {
    logger.warn("markSessionCompleted failed:", err.message);
  }
}

async function markSessionAbandoned(sessionId) {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .query(`
        UPDATE dbo.interview_sessions
        SET status = 'ABANDONED', ended_at = SYSUTCDATETIME(), completion_reason = 'reconnect_grace_period_expired', updated_at = SYSUTCDATETIME()
        WHERE id = @sessionId
      `);
  } catch (err) {
    logger.warn("markSessionAbandoned failed:", err.message);
  }
}

// Replay support (doc 03 §12): everything after a client's last-seen sequence,
// used to catch a reconnecting client up on whatever it missed.
async function fetchSessionEventsSinceSequence(sessionId, sinceSequence) {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .input("sinceSequence", sql.BigInt, sinceSequence || 0)
      .query(`
        SELECT event_id AS eventId, sequence, event_type AS type, payload, occurred_at AS occurredAt
        FROM dbo.interview_session_events
        WHERE session_id = @sessionId AND sequence > @sinceSequence
        ORDER BY sequence ASC
      `);
    return result.recordset.map((row) => ({
      eventId: row.eventId,
      sessionId,
      type: row.type,
      timestamp: new Date(row.occurredAt).toISOString(),
      sequence: row.sequence,
      payload: row.payload ? JSON.parse(row.payload) : {},
    }));
  } catch (err) {
    logger.warn("fetchSessionEventsSinceSequence failed:", err.message);
    return [];
  }
}

// doc 04 §2: keeps interview_sessions.current_section/current_question_id
// (present since Phase 1, unused until the Question Engine) in sync.
async function updateSessionSection(sessionId, section, questionAskedId) {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .input("section", sql.VarChar, section)
      .input("questionAskedId", sql.UniqueIdentifier, questionAskedId || null)
      .query(`
        UPDATE dbo.interview_sessions
        SET current_section = @section, current_question_id = @questionAskedId, updated_at = SYSUTCDATETIME()
        WHERE id = @sessionId
      `);
  } catch (err) {
    logger.warn("updateSessionSection failed:", err.message);
  }
}

// Interview Room MCQ interaction type: `mcqFields` is an optional trailing
// object ({interactionType, options, correctOption}) — existing call sites
// (voice questions, follow-ups) omit it entirely and get the same
// interaction_type='VOICE_QA' default the schema itself defaults to.
async function insertQuestionAskedRow(sessionId, section, sequence, isFollowUp, parentQuestionId, questionText, mcqFields = null) {
  const id = crypto.randomUUID();
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .input("section", sql.VarChar, section)
      .input("sequence", sql.Int, sequence)
      .input("questionText", sql.NVarChar, questionText)
      .input("isFollowUp", sql.Bit, Boolean(isFollowUp))
      .input("parentQuestionId", sql.UniqueIdentifier, parentQuestionId || null)
      .input("interactionType", sql.VarChar, (mcqFields && mcqFields.interactionType) || "VOICE_QA")
      .input("options", sql.NVarChar, mcqFields && mcqFields.options ? JSON.stringify(mcqFields.options) : null)
      .input("correctOption", sql.VarChar, (mcqFields && mcqFields.correctOption) || null)
      .query(`
        INSERT INTO dbo.interview_questions_asked
          (id, session_id, section, sequence, question_text, is_followup, parent_question_id,
           interaction_type, options, correct_option)
        VALUES
          (@id, @sessionId, @section, @sequence, @questionText, @isFollowUp, @parentQuestionId,
           @interactionType, @options, @correctOption)
      `);
  } catch (err) {
    logger.warn("insertQuestionAskedRow failed:", err.message);
  }
  return id;
}

async function markQuestionAskedCompleted(questionAskedId) {
  if (!questionAskedId) return;
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("id", sql.UniqueIdentifier, questionAskedId)
      .query(`UPDATE dbo.interview_questions_asked SET completed_at = SYSUTCDATETIME() WHERE id = @id`);
  } catch (err) {
    logger.warn("markQuestionAskedCompleted failed:", err.message);
  }
}

// Interview Room MCQ interaction type: records the candidate's selected
// option and completes the question in one write — mirrors
// markQuestionAskedCompleted's completed_at semantics for MCQ answers
// (voice answers get completed_at set here too, from handleAnswer's own
// markQuestionAskedCompleted call; this is the MCQ-only equivalent that also
// persists the answer itself, since MCQ answers never produce an
// interview_transcripts row the way STT does for voice answers).
async function recordMcqAnswer(questionAskedId, selectedOption) {
  if (!questionAskedId) return;
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("id", sql.UniqueIdentifier, questionAskedId)
      .input("selectedOption", sql.VarChar, selectedOption)
      .query(`
        UPDATE dbo.interview_questions_asked
        SET selected_option = @selectedOption, completed_at = SYSUTCDATETIME()
        WHERE id = @id
      `);
  } catch (err) {
    logger.warn("recordMcqAnswer failed:", err.message);
  }
}

// doc 04 §6 (JD/Resume Intelligence): reads the row practywiz-backend wrote
// at session-creation time (resume_reference is a public URL, context_snapshot
// carries the pasted jdText — see InterviewEngineControllers.js).
async function fetchSessionContext(sessionId) {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .query(`
        SELECT TOP 1 resume_reference AS resumeReference, jd_reference AS jdReference,
               context_snapshot AS contextSnapshot
        FROM dbo.interview_session_context
        WHERE session_id = @sessionId
        ORDER BY created_at DESC
      `);
    const row = result.recordset[0];
    if (!row) return null;
    return {
      resumeReference: row.resumeReference || null,
      jdReference: row.jdReference || null,
      contextSnapshot: row.contextSnapshot ? JSON.parse(row.contextSnapshot) : {},
    };
  } catch (err) {
    logger.warn("fetchSessionContext failed:", err.message);
    return null;
  }
}

// 03-LIVE-INTERVIEW-MODULE.md §8: records when the read-then-answer gate was
// cleared — also satisfies Session Logs' audit-trail requirement via the
// case.acknowledged envelope emitted alongside this call.
async function markCaseAcknowledged(sessionId) {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .query(`UPDATE dbo.interview_sessions SET case_acknowledged_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE id = @sessionId`);
  } catch (err) {
    logger.warn("markCaseAcknowledged failed:", err.message);
  }
}

// Interview Dashboard – Resume & JD Integration Requirement.md §15/§18:
// candidate-scoped "list my past interviews" for the new Reports tab — no
// equivalent existed before (every other report/session read is scoped to a
// single session_id). LEFT JOIN interview_reports since a session may not
// have completed report generation yet (or may have failed) — a Reports tab
// row still needs to show up as "generating"/"failed", not disappear.
async function fetchSessionsForCandidate(candidateId) {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("candidateId", sql.Int, candidateId)
      .query(`
        SELECT s.id AS sessionId, s.interview_id AS interviewId, s.status AS sessionStatus,
               s.started_at AS startedAt, s.ended_at AS endedAt,
               r.status AS reportStatus, r.report AS report, r.final_recommendation AS finalRecommendation,
               r.generated_at AS reportGeneratedAt,
               ctx.resume_reference AS resumeReference, ctx.jd_reference AS jdReference,
               ctx.context_snapshot AS contextSnapshot
        FROM dbo.interview_sessions s
        LEFT JOIN dbo.interview_reports r ON r.session_id = s.id
        OUTER APPLY (
          SELECT TOP 1 resume_reference, jd_reference, context_snapshot
          FROM dbo.interview_session_context
          WHERE session_id = s.id
          ORDER BY created_at DESC
        ) ctx
        WHERE s.candidate_id = @candidateId
        ORDER BY s.started_at DESC
      `);
    return result.recordset.map((row) => {
      const contextSnapshot = row.contextSnapshot ? JSON.parse(row.contextSnapshot) : {};
      const report = row.report ? JSON.parse(row.report) : null;
      return {
        sessionId: row.sessionId,
        interviewId: row.interviewId,
        sessionStatus: row.sessionStatus,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        reportStatus: row.reportStatus || (row.sessionStatus === "COMPLETED" ? "PENDING" : null),
        finalRecommendation: row.finalRecommendation,
        reportGeneratedAt: row.reportGeneratedAt,
        overallScore: report?.overall_score ?? null,
        resumeFileName: contextSnapshot?.resumeFileName || null,
        jdFileName: contextSnapshot?.jdFileName || null,
        resumeReference: row.resumeReference || null,
        jdReference: row.jdReference || null,
      };
    });
  } catch (err) {
    logger.warn("fetchSessionsForCandidate failed:", err.message);
    return [];
  }
}

module.exports = {
  insertInterviewSessionRow,
  insertInterviewSessionContextRow,
  insertSessionCreatedRow,
  markSessionReady,
  fetchSessionStatus,
  insertSessionEventRow,
  insertTranscriptRow,
  markSessionActive,
  markSessionCompleting,
  markSessionCompleted,
  markSessionAbandoned,
  fetchSessionEventsSinceSequence,
  updateSessionSection,
  insertQuestionAskedRow,
  markQuestionAskedCompleted,
  recordMcqAnswer,
  fetchSessionContext,
  fetchSessionsForCandidate,
  markCaseAcknowledged,
};
