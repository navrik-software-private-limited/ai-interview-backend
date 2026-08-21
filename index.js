const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const { createServer } = require("http");

const env = require("./config/env");
const logger = require("./logs/logger");
const { connectDatabase, closeDatabase } = require("./config/database");
const { attachSocketServer } = require("./communication/socketServer");
const proctoringRoutes = require("./proctoring/proctoringRoutes");
const caseRoutes = require("./case-study/caseRoutes");
const reportRoutes = require("./reporting/reportRoutes");
const sessionRoutes = require("./session/sessionRoutes");
const readinessRoutes = require("./readiness/readinessRoutes");
const adminConfigRoutes = require("./admin/adminConfigRoutes");
const candidateSessionsRoutes = require("./session/candidateSessionsRoutes");

const app = express();
const server = createServer(app);

app.use(cors({ origin: env.corsOrigin }));
app.use(helmet());
app.use(express.json());
app.use(morgan("common"));

app.get("/health", (req, res) => {
  res.json({ success: true, service: "ai-interview-backend", time: new Date().toISOString() });
});

app.use("/api/proctoring", proctoringRoutes);
app.use("/api/sessions", caseRoutes);
app.use("/api/sessions", reportRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/sessions", readinessRoutes);
app.use("/api/admin/interview-config", adminConfigRoutes);
app.use("/api/candidates", candidateSessionsRoutes);

attachSocketServer(server);

async function start() {
  await connectDatabase();
  server.listen(env.port, () => {
    logger.info(`🚀 ai-interview-backend listening on port ${env.port}`);
  });
}

async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}, shutting down...`);
  try {
    server.close();
    await closeDatabase();
    process.exit(0);
  } catch (err) {
    logger.error("Error during shutdown:", err.message);
    process.exit(1);
  }
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => logger.error("Unhandled rejection:", reason));

start().catch((err) => {
  logger.error("Failed to start ai-interview-backend:", err.message);
  process.exit(1);
});
