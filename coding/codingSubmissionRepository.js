const { getPool, sql } = require("../config/database");
const logger = require("../logs/logger");

// doc 06 §5-style / 03-LIVE-INTERVIEW-MODULE.md §9 — best-effort write, same
// pattern as every other repository in this codebase.
async function insertCodingSubmission(sessionId, { sequence, statement, language, code, evaluation }) {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .input("sequence", sql.Int, sequence)
      .input("statement", sql.NVarChar, statement)
      .input("language", sql.VarChar, language || null)
      .input("code", sql.NVarChar, code)
      .input("evaluation", sql.NVarChar, evaluation ? JSON.stringify(evaluation) : null)
      .query(`
        INSERT INTO dbo.interview_coding_submissions
          (id, session_id, sequence, problem_statement, language, code, evaluation)
        VALUES
          (NEWID(), @sessionId, @sequence, @statement, @language, @code, @evaluation)
      `);
  } catch (err) {
    logger.warn("insertCodingSubmission failed:", err.message);
  }
}

module.exports = { insertCodingSubmission };
