const { getPool, sql } = require("../config/database");
const logger = require("../logs/logger");

// doc 04 §4 / doc 06 §5 face_events — best-effort write, same pattern as
// session/sessionRepository.js: must never break the live face-tracking loop.
async function insertFaceEvent(sessionId, eventType, { severity, confidence = null, durationMs = null, metadata = null }) {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .input("eventType", sql.VarChar, eventType)
      .input("severity", sql.VarChar, severity)
      .input("confidence", sql.Decimal(4, 3), confidence)
      .input("durationMs", sql.Int, durationMs)
      .input("metadata", sql.NVarChar, metadata ? JSON.stringify(metadata) : null)
      .query(`
        INSERT INTO dbo.face_events (id, session_id, event_type, severity, confidence, duration_ms, metadata)
        VALUES (NEWID(), @sessionId, @eventType, @severity, @confidence, @durationMs, @metadata)
      `);
  } catch (err) {
    logger.warn("insertFaceEvent failed:", err.message);
  }
}

module.exports = { insertFaceEvent };
