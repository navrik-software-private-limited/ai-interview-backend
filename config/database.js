const mssql = require("mssql");
const env = require("./env");

let poolPromise = null;

function buildConfig() {
  return {
    server: env.db.server,
    port: env.db.port,
    database: env.db.database,
    user: env.db.user,
    password: env.db.password,
    // Matches practywiz-backend/Config/dbConfig.js — this RDS instance's
    // certificate chain isn't in Node's default trust store, so verification
    // must be relaxed the same way the existing backend already does.
    options: { encrypt: true, trustServerCertificate: true },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  };
}

async function connectDatabase() {
  if (!poolPromise) {
    poolPromise = mssql
      .connect(buildConfig())
      .then((pool) => {
        console.log("✔ [ai-interview-backend] Database connected");
        pool.on("error", (err) => {
          console.error("✖ [ai-interview-backend] Pool error", err.message);
          poolPromise = null;
        });
        return pool;
      })
      .catch((err) => {
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

async function getPool() {
  return connectDatabase();
}

async function closeDatabase() {
  if (poolPromise) {
    const pool = await poolPromise;
    await pool.close();
    poolPromise = null;
  }
}

module.exports = { connectDatabase, getPool, closeDatabase, sql: mssql };
