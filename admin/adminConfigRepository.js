const { getPool, sql } = require("../config/database");
const logger = require("../logs/logger");

function mapRow(row) {
  return {
    id: row.id,
    name: row.name,
    configuration: JSON.parse(row.configuration),
    estimatedDurationMinutes: row.estimatedDurationMinutes,
    isActive: Boolean(row.isActive),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function listConfigurations() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, name, configuration, estimated_duration_minutes AS estimatedDurationMinutes,
           is_active AS isActive, version, created_at AS createdAt, updated_at AS updatedAt
    FROM dbo.interview_configurations
    ORDER BY created_at DESC
  `);
  return result.recordset.map(mapRow);
}

async function getActiveConfiguration() {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT TOP 1 id, name, configuration, estimated_duration_minutes AS estimatedDurationMinutes,
             is_active AS isActive, version, created_at AS createdAt, updated_at AS updatedAt
      FROM dbo.interview_configurations
      WHERE is_active = 1
    `);
    return result.recordset[0] ? mapRow(result.recordset[0]) : null;
  } catch (err) {
    // Called on the interview-start hot path — must never block a session
    // from starting. Missing/broken config just falls back to
    // sectionPlan.js's hardcoded defaults (see interviewController.js).
    logger.warn("getActiveConfiguration failed:", err.message);
    return null;
  }
}

// New versions never overwrite an existing row — each Save from the admin
// page is a new version, activated separately (activateConfiguration).
async function createConfiguration({ name, configuration, estimatedDurationMinutes }) {
  const pool = await getPool();
  const versionResult = await pool
    .request()
    .input("name", sql.NVarChar, name)
    .query(`SELECT ISNULL(MAX(version), 0) + 1 AS nextVersion FROM dbo.interview_configurations WHERE name = @name`);
  const nextVersion = versionResult.recordset[0].nextVersion;

  const result = await pool
    .request()
    .input("name", sql.NVarChar, name)
    .input("configuration", sql.NVarChar, JSON.stringify(configuration))
    .input("estimatedDurationMinutes", sql.Int, estimatedDurationMinutes || null)
    .input("version", sql.Int, nextVersion)
    .query(`
      INSERT INTO dbo.interview_configurations
        (id, name, configuration, estimated_duration_minutes, is_active, version)
      OUTPUT INSERTED.id
      VALUES
        (NEWID(), @name, @configuration, @estimatedDurationMinutes, 0, @version)
    `);
  return result.recordset[0].id;
}

// Transactional flip: exactly one row is_active = 1 at any time.
async function activateConfiguration(id) {
  const pool = await getPool();
  const transaction = pool.transaction();
  await transaction.begin();
  try {
    await transaction.request().query(`UPDATE dbo.interview_configurations SET is_active = 0, updated_at = SYSUTCDATETIME() WHERE is_active = 1`);
    await transaction
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .query(`UPDATE dbo.interview_configurations SET is_active = 1, updated_at = SYSUTCDATETIME() WHERE id = @id`);
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = { listConfigurations, getActiveConfiguration, createConfiguration, activateConfiguration };
