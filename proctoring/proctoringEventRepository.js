const { getPool, sql } = require("../config/database");
const logger = require("../logs/logger");

// doc 06 §5 / L2-05 §3 proctoring_events — best-effort write, same pattern as
// session/sessionRepository.js: must never break the live interview loop.
async function insertProctoringEvent(sessionId, eventType, { severity, confidence = null, durationMs = null, evidence = null }) {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .input("eventType", sql.VarChar, eventType)
      .input("severity", sql.VarChar, severity)
      .input("confidence", sql.Decimal(4, 3), confidence)
      .input("durationMs", sql.Int, durationMs)
      .input("evidence", sql.NVarChar, evidence ? JSON.stringify(evidence) : null)
      .query(`
        INSERT INTO dbo.proctoring_events (id, session_id, event_type, severity, confidence, duration_ms, evidence)
        VALUES (NEWID(), @sessionId, @eventType, @severity, @confidence, @durationMs, @evidence)
      `);
  } catch (err) {
    logger.warn("insertProctoringEvent failed:", err.message);
  }
}

// L2-05 §7: GET /api/proctoring/{session_id}/events
async function fetchProctoringEvents(sessionId) {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .query(`
        SELECT id, session_id AS sessionId, event_type AS eventType, severity, confidence,
               duration_ms AS durationMs, evidence, [timestamp]
        FROM dbo.proctoring_events
        WHERE session_id = @sessionId
        ORDER BY [timestamp] ASC
      `);
    return result.recordset.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      eventType: row.eventType,
      severity: row.severity,
      confidence: row.confidence,
      durationMs: row.durationMs,
      evidence: row.evidence ? JSON.parse(row.evidence) : {},
      timestamp: row.timestamp,
    }));
  } catch (err) {
    logger.warn("fetchProctoringEvents failed:", err.message);
    return [];
  }
}

module.exports = { insertProctoringEvent, fetchProctoringEvents };
