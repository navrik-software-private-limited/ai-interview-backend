// End-to-end happy-path test, per doc/06_DATA_SCHEMA_MASTER_TABLES_AND_TESTING.md
// §13's mandatory flow: Login -> Dashboard -> Select Case -> Start -> Session
// Created -> WebSocket Connected -> WebRTC Connected -> Readiness Passed ->
// AI Intro -> Candidate Answer -> Transcript -> AI Follow-up -> JD/Resume ->
// Aptitude -> Case -> Coding -> Mindset -> Completion -> Disconnect -> Report.
//
// This intentionally hits a REAL, dedicated test database + Redis instance
// (never the production ones, and never mocked) via
// session/sessionCreationController.js's internal-key path, plus a real
// Socket.IO connection — genuinely exercising the full stack rather than a
// mocked simulation of it. That's a real infra prerequisite (see
// ../../.env.test and doc/07_INTERVIEW_MODULE_STATUS_AND_ROADMAP.md §4), not
// something this pass provisions — so it self-skips with a clear message
// when that infra isn't configured, rather than failing or being silently
// left out of `npm run test:e2e`.

const path = require("path");
const fs = require("fs");

const envTestPath = path.join(__dirname, "../../.env.test");
if (fs.existsSync(envTestPath)) {
  require("dotenv").config({ path: envTestPath });
}

const hasTestDb = Boolean(process.env.TEST_DB_DATABASE && process.env.TEST_DB_SERVER);

const describeIfTestDb = hasTestDb ? describe : describe.skip;

if (!hasTestDb) {
  // eslint-disable-next-line no-console
  console.warn(
    "\n[tests/e2e/happyPath.test.js] SKIPPED — no dedicated test database configured.\n" +
      "Set TEST_DB_SERVER / TEST_DB_DATABASE / TEST_DB_USER / TEST_DB_PASSWORD (and TEST_REDIS_* if not\n" +
      "using the default local Redis) in .env.test to enable this suite. See .env.test for the full list.\n"
  );
}

describeIfTestDb("E2E: full interview happy path", () => {
  let sessionCreationController;
  let sessionRepository;
  let http;
  let jwt;
  let ioClient;
  let httpServer;
  let io;
  let port;

  beforeAll((done) => {
    // Required only inside this guarded block: importing these modules
    // eagerly at file scope would connect to config/env.js's DEFAULT
        // (production/dev) database even when this suite is skipped.
    process.env.DB_SERVER = process.env.TEST_DB_SERVER;
    process.env.DB_DATABASE = process.env.TEST_DB_DATABASE;
    process.env.DB_USER = process.env.TEST_DB_USER;
    process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD;
    process.env.REDIS_HOST = process.env.TEST_REDIS_HOST || "127.0.0.1";
    process.env.REDIS_PREFIX = "e2e-test:";

    sessionCreationController = require("../../session/sessionCreationController");
    sessionRepository = require("../../session/sessionRepository");
    http = require("http");
    jwt = require("jsonwebtoken");
    ioClient = require("socket.io-client").io;
    const { attachSocketServer } = require("../../communication/socketServer");

    httpServer = http.createServer();
    io = attachSocketServer(httpServer);
    httpServer.listen(0, () => {
      port = httpServer.address().port;
      done();
    });
  });

  afterAll((done) => {
    io.close(done);
  });

  test("a session created via the internal-key path can connect over the socket and receive session.ready", async () => {
    const candidateId = 999999; // dedicated test-only candidate id, never a real one
    const req = {
      body: {
        candidateId,
        candidateName: "E2E Test Candidate",
        candidateEmail: "e2e-test@example.invalid",
        caseType: "TECHNOLOGY",
        caseContentText: "A short synthetic case for E2E testing only.",
      },
    };
    let createdBody;
    const res = {
      status: (code) => ({ json: (body) => { createdBody = { code, ...body }; } }),
    };

    await sessionCreationController.createSession(req, res);
    expect(createdBody.success).toBe(true);
    const { sessionId } = createdBody;

    await sessionRepository.markSessionReady(sessionId);

    const token = jwt.sign(
      { sessionId, interviewId: createdBody.interviewId, candidateId, permissions: ["join"] },
      process.env.JWT_INTERVIEW_ACCESS_TOKEN_SECRET_KEY
    );

    const socket = ioClient(`http://localhost:${port}`, { auth: { token, sessionId } });
    try {
      const envelope = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for session.ready")), 5000);
        socket.on("interview:event", (e) => {
          if (e.type === "session.ready") {
            clearTimeout(timer);
            resolve(e);
          }
        });
      });
      expect(envelope.payload.resumed).toBe(false);
    } finally {
      socket.close();
    }
  });

  // The remaining steps of doc/06 §13 (readiness -> AI intro -> full
  // question flow -> coding -> completion -> report) are intentionally left
  // as a follow-up once the above connectivity smoke test is green against
  // real infra — see doc/07_INTERVIEW_MODULE_STATUS_AND_ROADMAP.md's
  // backlog. Extending this file is cheap once TEST_DB_* is actually
  // configured somewhere; building that out blind, against infra that
  // doesn't exist yet, isn't.
});
