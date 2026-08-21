const { getPool, sql } = require("../config/database");

// CRUD for dbo.interview_reports, same raw-parameterized-mssql convention as
// admin/adminConfigRepository.js. Errors are NOT swallowed here (unlike the
// live-session hot-path repositories) — evaluationPipeline.js's single
// top-level catch is what turns a failure into a `FAILED` status write; if
// even that write fails, letting the error surface to the caller/logs is
// more honest than silently pretending it succeeded.

function mapRow(row) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    status: row.status,
    report: row.report ? JSON.parse(row.report) : null,
    finalRecommendation: row.finalRecommendation,
    errorMessage: row.errorMessage,
    generatedAt: row.generatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function fetchReport(sessionId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query(`
      SELECT id, session_id AS sessionId, status, report, final_recommendation AS finalRecommendation,
             error_message AS errorMessage, generated_at AS generatedAt, created_at AS createdAt, updated_at AS updatedAt
      FROM dbo.interview_reports
      WHERE session_id = @sessionId
    `);
  return result.recordset[0] ? mapRow(result.recordset[0]) : null;
}

// Upsert so evaluationPipeline.js can call this at every stage transition
// (GENERATING -> COMPLETED|FAILED) without needing to know whether a row
// already exists.
async function markGenerating(sessionId) {
  const pool = await getPool();
  await pool
    .request()
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query(`
      MERGE dbo.interview_reports AS target
      USING (SELECT @sessionId AS session_id) AS source
      ON target.session_id = source.session_id
      WHEN MATCHED THEN UPDATE SET status = 'GENERATING', error_message = NULL, updated_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (id, session_id, status)
      VALUES (NEWID(), @sessionId, 'GENERATING');
    `);
}

async function markCompleted(sessionId, report, finalRecommendation) {
  const pool = await getPool();
  await pool
    .request()
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .input("report", sql.NVarChar, JSON.stringify(report))
    .input("finalRecommendation", sql.VarChar, finalRecommendation)
    .query(`
      UPDATE dbo.interview_reports
      SET status = 'COMPLETED', report = @report, final_recommendation = @finalRecommendation,
          generated_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
      WHERE session_id = @sessionId
    `);
}

async function markFailed(sessionId, errorMessage) {
  const pool = await getPool();
  await pool
    .request()
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .input("errorMessage", sql.NVarChar, String(errorMessage).slice(0, 500))
    .query(`
      MERGE dbo.interview_reports AS target
      USING (SELECT @sessionId AS session_id) AS source
      ON target.session_id = source.session_id
      WHEN MATCHED THEN UPDATE SET status = 'FAILED', error_message = @errorMessage, updated_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (id, session_id, status, error_message)
      VALUES (NEWID(), @sessionId, 'FAILED', @errorMessage);
    `);
}

module.exports = { fetchReport, markGenerating, markCompleted, markFailed };
