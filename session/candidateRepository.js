const { getPool, sql } = require("../config/database");
const logger = require("../logs/logger");

// 00-MASTER-ARCHITECTURE.md §2: "a lightweight local Candidate reference
// (id, name, email) populated at session-creation time — not a live join
// into Practywiz's user table." id is the same integer as practywiz's
// dbo.users_dtls.user_dtls_id (not an enforced cross-db FK, same convention
// as interview_sessions.candidate_id).
async function upsertCandidateReference({ candidateId, name, email }) {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("candidateId", sql.Int, candidateId)
      .input("name", sql.NVarChar, name || null)
      .input("email", sql.NVarChar, email || null)
      .query(`
        IF EXISTS (SELECT 1 FROM dbo.interview_candidates WHERE id = @candidateId)
          UPDATE dbo.interview_candidates
          SET name = @name, email = @email, updated_at = SYSUTCDATETIME()
          WHERE id = @candidateId
        ELSE
          INSERT INTO dbo.interview_candidates (id, name, email)
          VALUES (@candidateId, @name, @email)
      `);
  } catch (err) {
    // Best-effort reference cache — must never block session creation.
    logger.warn("upsertCandidateReference failed:", err.message);
  }
}

// doc/07_INTERVIEW_MODULE_STATUS_AND_ROADMAP.md gap #9: read counterpart to
// upsertCandidateReference above — this table was write-only before (the
// only reader was evaluation/sessionDataLoader.js's own separate query, used
// post-interview for report generation). A single indexed point lookup, so
// interviewer/interviewController.js awaits it directly at greeting time
// rather than needing the fire-and-forget/cache-on-session treatment
// jd-resume context gets (that one's LLM-bound and slow; this isn't).
async function fetchCandidateName(candidateId) {
  if (!candidateId) return null;
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("candidateId", sql.Int, candidateId)
      .query(`SELECT name FROM dbo.interview_candidates WHERE id = @candidateId`);
    return result.recordset[0]?.name || null;
  } catch (err) {
    logger.warn("fetchCandidateName failed:", err.message);
    return null;
  }
}

module.exports = { upsertCandidateReference, fetchCandidateName };
