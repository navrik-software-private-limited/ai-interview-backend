// Integration tests for communication/socketServer.js — spins up a REAL
// Socket.IO server (via attachSocketServer) and connects with a real
// socket.io-client, but every DB/Redis/LLM-touching dependency is mocked.
// communication/envelope.js itself is left real (not mocked) so its actual
// sequencing/broadcast logic runs — it depends only on the mocked
// session/sessionStore + session/sessionRepository underneath.

// Must come before anything that transitively requires it: config/redis.js
// opens a REAL ioredis connection as a module-load side effect. Without this,
// automocking session/sessionStore still loads the real module tree once to
// introspect its shape, which was opening a live connection to the dev Redis
// instance and leaving a TCPWRAP handle open (jest/node then hangs on exit).
jest.mock("../../config/redis", () => require("../helpers/mockRedis").createMockRedisClient());

const TEST_SECRET = "test-secret";
const GRACE_PERIOD_MS = 200;

// Full shape matters even though this test only reads a few fields directly:
// automocking interviewer/interviewController (below) still loads the real
// module tree once to introspect it, which reaches interviewer/llmClient.js
// (`new ChatOpenAI({ apiKey: env.openai.apiKey, ... })` at module scope) and
// speech/sttClient.js / speech/ttsClient.js — all of which read `env.openai`/
// `env.elevenLabs` at load or call time.
jest.mock("../../config/env", () => ({
  port: 0,
  corsOrigin: "*",
  reconnectGracePeriodMs: 200,
  jwtInterviewAccessTokenSecretKey: "test-secret",
  internalServiceKey: "test-internal-key",
  openai: { apiKey: undefined, model: "gpt-4o-mini" },
  elevenLabs: { apiKey: undefined, sttModelId: "scribe_v1", ttsVoiceId: undefined, ttsModelId: "eleven_turbo_v2_5" },
  db: { server: "localhost", port: 1433, database: "test", user: "test", password: "test" },
  redis: { host: "localhost", port: 6379, password: undefined, tls: undefined, keyPrefix: "test:" },
}));

jest.mock("../../session/sessionStore");
jest.mock("../../session/sessionRepository");
jest.mock("../../jd-resume/textExtractor");
jest.mock("../../jd-resume/contextBuilder");
jest.mock("../../face-tracking/faceTrackingService");
jest.mock("../../case-study/caseFlowController");
jest.mock("../../interviewer/interviewController");
jest.mock("../../evaluation/evaluationPipeline");
// Explicit factory: peerConnectionManager.js requires the native @roamhq/wrtc
// addon at module top-level — automocking would still load the real module
// first to introspect its shape, pulling in that native binary for nothing.
jest.mock("../../webrtc/peerConnectionManager", () => ({
  handleOffer: jest.fn(),
  addIceCandidate: jest.fn(),
  getAudioSource: jest.fn(),
  closePeerConnection: jest.fn(),
}));
// doc/07 gap #3: socketServer.js now calls this on every session.ready. A
// fixed factory mock keeps this file's session.ready assertions predictable
// and decoupled from config/env's webrtc shape.
jest.mock("../../webrtc/iceServersConfig", () => ({
  getIceServers: jest.fn(() => [{ urls: "stun:stun.l.google.com:19302" }]),
}));
// doc/07 gap #4: these delegate to proctoringService, which touches
// proctoringEventRepository (real mssql) and scoreTracker (real Redis) —
// mocked wholesale here for the same reason face-tracking/case-study are:
// this file tests the socket dispatch layer, not proctoring's own logic
// (that's covered by tests/unit/proctoring/*).
jest.mock("../../proctoring/activityMonitorService");
jest.mock("../../proctoring/codingActivityService");
jest.mock("../../proctoring/sources/connectivityEventAdapter");

const http = require("http");
const jwt = require("jsonwebtoken");
const { io: ioClient } = require("socket.io-client");
const { attachSocketServer } = require("../../communication/socketServer");
const sessionStore = require("../../session/sessionStore");
const sessionRepository = require("../../session/sessionRepository");
const activityMonitorService = require("../../proctoring/activityMonitorService");
const codingActivityService = require("../../proctoring/codingActivityService");
const { forwardConnectivityEvent } = require("../../proctoring/sources/connectivityEventAdapter");
const evaluationPipeline = require("../../evaluation/evaluationPipeline");

const EVENT_NAME = "interview:event";

function signToken(payload) {
  return jwt.sign(payload, TEST_SECRET);
}

function connectClient(sessionId, { token = signToken({ sessionId, interviewId: "i1", candidateId: "c1" }) } = {}) {
  return { socket: ioClient(`http://localhost:${global.__TEST_PORT__}`, { auth: { token, sessionId }, forceNew: true }) };
}

function waitForEvent(socket, eventName, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${eventName}"`)), timeoutMs);
    socket.once(eventName, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function waitForEnvelopeType(socket, type, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for envelope type "${type}"`)), timeoutMs);
    function handler(envelope) {
      if (envelope.type === type) {
        clearTimeout(timer);
        socket.off(EVENT_NAME, handler);
        resolve(envelope);
      }
    }
    socket.on(EVENT_NAME, handler);
  });
}

describe("communication/socketServer", () => {
  let httpServer;
  let io;
  const openClients = [];

  beforeAll((done) => {
    httpServer = http.createServer();
    io = attachSocketServer(httpServer);
    httpServer.listen(0, () => {
      global.__TEST_PORT__ = httpServer.address().port;
      done();
    });
  });

  afterAll((done) => {
    io.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    sessionRepository.fetchSessionStatus.mockResolvedValue("READY");
    sessionRepository.markSessionActive.mockResolvedValue(undefined);
    sessionRepository.markSessionAbandoned.mockResolvedValue(undefined);
    evaluationPipeline.generateReport.mockResolvedValue({});
    sessionRepository.insertSessionEventRow.mockResolvedValue(undefined);
    sessionRepository.fetchSessionEventsSinceSequence.mockResolvedValue([]);
    sessionRepository.fetchSessionContext.mockResolvedValue(null);

    sessionStore.createOrResumeSession.mockResolvedValue({
      session: { sessionId: "s", resumeContext: null },
      resumed: false,
    });
    sessionStore.touchSession.mockResolvedValue(undefined);
    sessionStore.nextSequence.mockImplementation((() => {
      let seq = 0;
      return async () => ++seq;
    })());
    sessionStore.endSession.mockResolvedValue(undefined);

    activityMonitorService.handleActivityEvent.mockResolvedValue(undefined);
    codingActivityService.handlePasteEvent.mockResolvedValue(undefined);
    forwardConnectivityEvent.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    while (openClients.length) {
      const c = openClients.pop();
      if (c.connected) c.close();
    }
    // Every disconnect (even this deliberate cleanup) arms the server's
    // reconnect-grace-period timer for that session. Wait it out here so a
    // stray markSessionAbandoned call from THIS test's cleanup can never fire
    // during (and pollute) the next test's assertions — the module-level
    // `disconnectTimers` map in socketServer.js persists across tests.
    await new Promise((resolve) => setTimeout(resolve, GRACE_PERIOD_MS + 150));
  });

  test("rejects a connection with no auth token", async () => {
    const { socket } = connectClient("session-no-token", { token: "" });
    openClients.push(socket);
    const err = await waitForEvent(socket, "connect_error");
    expect(err.message).toBe("unauthorized");
  });

  test("rejects a connection with a token signed by the wrong secret", async () => {
    const badToken = jwt.sign({ sessionId: "s1" }, "wrong-secret");
    const { socket } = connectClient("session-bad-sig", { token: badToken });
    openClients.push(socket);
    const err = await waitForEvent(socket, "connect_error");
    expect(err.message).toBe("unauthorized");
  });

  test("emits session.failed(not_ready) and disconnects when the session isn't joinable yet", async () => {
    sessionRepository.fetchSessionStatus.mockResolvedValue("CREATED");
    const { socket } = connectClient("session-not-ready");
    openClients.push(socket);

    // Registered before awaiting the envelope: the server emits
    // session.failed then immediately disconnects, so attaching this
    // listener afterward risks missing the event entirely.
    const disconnectPromise = waitForEvent(socket, "disconnect");
    const envelope = await waitForEnvelopeType(socket, "session.failed");
    expect(envelope.payload.reason).toBe("not_ready");
    await disconnectPromise;
  });

  test("emits session.ready on a successful, joinable connection", async () => {
    const { socket } = connectClient("session-ready-1");
    openClients.push(socket);

    const envelope = await waitForEnvelopeType(socket, "session.ready");
    expect(envelope.payload).toEqual({
      resumed: false,
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    expect(sessionRepository.markSessionActive).toHaveBeenCalledWith("session-ready-1");
  });

  test("session.resume replays missed events directly to the requesting socket, then confirms resume", async () => {
    const missedEvents = [
      { eventId: "e1", sessionId: "session-resume-1", type: "question.started", timestamp: "t1", sequence: 1, payload: {} },
      { eventId: "e2", sessionId: "session-resume-1", type: "transcript.final", timestamp: "t2", sequence: 2, payload: {} },
    ];
    sessionRepository.fetchSessionEventsSinceSequence.mockResolvedValue(missedEvents);

    const { socket } = connectClient("session-resume-1");
    openClients.push(socket);
    await waitForEnvelopeType(socket, "session.ready");

    const received = [];
    socket.on(EVENT_NAME, (envelope) => received.push(envelope));

    socket.emit(EVENT_NAME, {
      sessionId: "session-resume-1",
      type: "session.resume",
      payload: { lastSequence: 0 },
    });

    await waitForEnvelopeType(socket, "session.state");

    const types = received.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["question.started", "transcript.final", "session.resumed", "session.state"]));
    expect(sessionRepository.fetchSessionEventsSinceSequence).toHaveBeenCalledWith("session-resume-1", 0);
  });

  test("heartbeat envelopes touch the session (keep it alive) without erroring", async () => {
    const { socket } = connectClient("session-heartbeat-1");
    openClients.push(socket);
    await waitForEnvelopeType(socket, "session.ready");

    const callsBefore = sessionStore.touchSession.mock.calls.length;
    socket.emit(EVENT_NAME, { sessionId: "session-heartbeat-1", type: "heartbeat", payload: {} });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sessionStore.touchSession.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  test("an envelope for a mismatched sessionId is ignored", async () => {
    const { socket } = connectClient("session-mismatch-1");
    openClients.push(socket);
    await waitForEnvelopeType(socket, "session.ready");

    const callsBefore = sessionStore.touchSession.mock.calls.length;
    socket.emit(EVENT_NAME, { sessionId: "some-other-session", type: "heartbeat", payload: {} });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sessionStore.touchSession.mock.calls.length).toBe(callsBefore);
  });

  test("reconnecting within the grace period cancels the pending abandonment", async () => {
    const sessionId = "session-reconnect-1";
    const { socket: first } = connectClient(sessionId);
    openClients.push(first);
    await waitForEnvelopeType(first, "session.ready");

    first.close();
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the disconnect handler register

    const { socket: second } = connectClient(sessionId);
    openClients.push(second);
    await waitForEnvelopeType(second, "session.ready");

    // Wait past the original grace period (measured from the first disconnect).
    await new Promise((resolve) => setTimeout(resolve, GRACE_PERIOD_MS + 100));

    expect(sessionRepository.markSessionAbandoned).not.toHaveBeenCalled();
  });

  test("no reconnect within the grace period marks the session abandoned and notifies the room", async () => {
    const sessionId = "session-abandon-1";
    const { socket: leaving } = connectClient(sessionId);
    const { socket: observer } = connectClient(sessionId);
    openClients.push(leaving, observer);

    await waitForEnvelopeType(leaving, "session.ready");
    await waitForEnvelopeType(observer, "session.ready");

    const abandonedPromise = waitForEnvelopeType(observer, "session.failed", GRACE_PERIOD_MS + 2000);
    leaving.close();

    const envelope = await abandonedPromise;
    expect(envelope.payload.reason).toBe("abandoned");
    expect(sessionRepository.markSessionAbandoned).toHaveBeenCalledWith(sessionId);
    // doc/07 gap #4: connectivity-monitor — the candidate never reconnected.
    expect(forwardConnectivityEvent).toHaveBeenCalledWith(
      io,
      sessionId,
      expect.objectContaining({ eventType: "SESSION_ABANDONED", severity: "CRITICAL" })
    );
    // doc/07 gap #11: an abandoned session used to never get a report at
    // all — now it's treated as terminal, same as a clean finish.
    await new Promise((resolve) => setTimeout(resolve, 20)); // fire-and-forget, let the microtask run
    expect(evaluationPipeline.generateReport).toHaveBeenCalledWith(sessionId);
  });

  test("a disconnect forwards a connectivity-monitor WARNING event", async () => {
    const sessionId = "session-connectivity-1";
    const { socket } = connectClient(sessionId);
    openClients.push(socket);
    await waitForEnvelopeType(socket, "session.ready");

    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(forwardConnectivityEvent).toHaveBeenCalledWith(
      io,
      sessionId,
      expect.objectContaining({ eventType: "SESSION_DISCONNECTED", severity: "WARNING" })
    );
  });

  test("an activity.status envelope routes to activityMonitorService", async () => {
    const sessionId = "session-activity-1";
    const { socket } = connectClient(sessionId);
    openClients.push(socket);
    await waitForEnvelopeType(socket, "session.ready");

    socket.emit(EVENT_NAME, { sessionId, type: "activity.status", payload: { eventType: "TAB_HIDDEN" } });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(activityMonitorService.handleActivityEvent).toHaveBeenCalledWith(
      io,
      sessionId,
      { eventType: "TAB_HIDDEN" }
    );
  });

  test("a coding.activity envelope routes to codingActivityService", async () => {
    const sessionId = "session-coding-activity-1";
    const { socket } = connectClient(sessionId);
    openClients.push(socket);
    await waitForEnvelopeType(socket, "session.ready");

    socket.emit(EVENT_NAME, {
      sessionId,
      type: "coding.activity",
      payload: { eventType: "PASTE_DETECTED", charCount: 200 },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(codingActivityService.handlePasteEvent).toHaveBeenCalledWith(
      io,
      sessionId,
      { eventType: "PASTE_DETECTED", charCount: 200 }
    );
  });
});
