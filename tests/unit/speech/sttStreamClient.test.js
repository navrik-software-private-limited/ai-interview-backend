jest.mock("../../../config/env", () => ({
  elevenLabs: { apiKey: "test-key", sttRealtimeModelId: "scribe_v2_realtime" },
}));
jest.mock("../../../speech/sttClient");

const sttClient = require("../../../speech/sttClient");

class FakeWebSocket {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.readyState = FakeWebSocket.CONNECTING;
    this.listeners = {};
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  send(data) {
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this._emit("close", {});
  }
  _emit(type, event) {
    (this.listeners[type] || []).forEach((fn) => fn(event));
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this._emit("open", {});
  }
  message(payload) {
    this._emit("message", { data: JSON.stringify(payload) });
  }
  error() {
    this._emit("error", {});
  }
}
FakeWebSocket.CONNECTING = 0;
FakeWebSocket.OPEN = 1;
FakeWebSocket.CLOSED = 3;
FakeWebSocket.instances = [];

global.WebSocket = FakeWebSocket;

const sttStreamClient = require("../../../speech/sttStreamClient");

const SESSION_ID = "session-1";

function samples(n = 10) {
  return new Int16Array(n).fill(1234);
}

describe("speech/sttStreamClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    FakeWebSocket.instances = [];
    sttStreamClient.closeSession(SESSION_ID);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("openIfNeeded opens exactly one WebSocket per utterance, with auth header and pcm format matching sampleRate", () => {
    sttStreamClient.openIfNeeded(SESSION_ID, 48000, () => {});
    sttStreamClient.openIfNeeded(SESSION_ID, 48000, () => {}); // second call is a no-op

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];
    expect(ws.url).toContain("audio_format=pcm_48000");
    expect(ws.url).toContain("commit_strategy=manual");
    expect(ws.url).toContain("model_id=scribe_v2_realtime");
    expect(ws.options.headers["xi-api-key"]).toBe("test-key");
  });

  test("does not open a stream at all when no API key is configured", () => {
    jest.resetModules();
    jest.doMock("../../../config/env", () => ({ elevenLabs: { apiKey: undefined } }));
    const freshClient = require("../../../speech/sttStreamClient");

    freshClient.openIfNeeded(SESSION_ID, 48000, () => {});

    expect(FakeWebSocket.instances).toHaveLength(0);
    jest.dontMock("../../../config/env");
  });

  test("fires onPartialTranscript for each partial_transcript message", () => {
    const onPartial = jest.fn();
    sttStreamClient.openIfNeeded(SESSION_ID, 48000, onPartial);
    const ws = FakeWebSocket.instances[0];
    ws.open();

    ws.message({ message_type: "partial_transcript", text: "hello" });
    ws.message({ message_type: "partial_transcript", text: "hello there" });

    expect(onPartial).toHaveBeenCalledWith("hello");
    expect(onPartial).toHaveBeenCalledWith("hello there");
  });

  test("batches frames and only sends once ~100ms of audio has accumulated", () => {
    sttStreamClient.openIfNeeded(SESSION_ID, 48000, () => {});
    const ws = FakeWebSocket.instances[0];
    ws.open();

    for (let i = 0; i < 9; i++) sttStreamClient.sendChunk(SESSION_ID, samples(480)); // 9*480 = 4320, under the 4800 batch threshold
    expect(ws.sent).toHaveLength(0);

    sttStreamClient.sendChunk(SESSION_ID, samples(480)); // crosses 4800
    expect(ws.sent).toHaveLength(1);
    const message = JSON.parse(ws.sent[0]);
    expect(message.message_type).toBe("input_audio_chunk");
    expect(message.commit).toBe(false);
    expect(typeof message.audio_base_64).toBe("string");
  });

  test("finishTranscription sends a final commit:true chunk and resolves with the committed transcript, closing the stream", async () => {
    sttStreamClient.openIfNeeded(SESSION_ID, 48000, () => {});
    const ws = FakeWebSocket.instances[0];
    ws.open();
    sttStreamClient.sendChunk(SESSION_ID, samples(100));

    const promise = sttStreamClient.finishTranscription(SESSION_ID, Buffer.alloc(10), 48000);
    await Promise.resolve(); // let the commit message send synchronously inside finishTranscription
    const lastMessage = JSON.parse(ws.sent[ws.sent.length - 1]);
    expect(lastMessage.commit).toBe(true);

    ws.message({ message_type: "committed_transcript", text: "final answer text" });

    await expect(promise).resolves.toBe("final answer text");
    expect(sttClient.transcribeUtterance).not.toHaveBeenCalled();
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
  });

  test("falls back to batch sttClient.transcribeUtterance when the stream was never opened (no healthy connection)", async () => {
    sttClient.transcribeUtterance.mockResolvedValue("batch transcript");

    const result = await sttStreamClient.finishTranscription(SESSION_ID, Buffer.alloc(10), 48000);

    expect(result).toBe("batch transcript");
    expect(sttClient.transcribeUtterance).toHaveBeenCalledWith(Buffer.alloc(10), 48000);
  });

  test("falls back to batch when the stream goes unhealthy (an error message arrives) before finishing", async () => {
    sttClient.transcribeUtterance.mockResolvedValue("batch transcript");
    sttStreamClient.openIfNeeded(SESSION_ID, 48000, () => {});
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.message({ message_type: "auth_error", error: "invalid key" });

    const result = await sttStreamClient.finishTranscription(SESSION_ID, Buffer.alloc(10), 48000);

    expect(result).toBe("batch transcript");
  });

  test("a rejection message that arrives after the final commit was sent (e.g. commit_throttled) falls back immediately, without waiting out the full commit timeout", async () => {
    // Verified against a real production log: ElevenLabs can reject a
    // commit (too little uncommitted audio) after finishTranscription has
    // already started waiting on committedResolvers — previously nothing
    // woke that wait up, so it silently sat out the full 8s COMMIT_TIMEOUT_MS
    // before falling back. No fake timers used here deliberately: if this
    // regresses back to needing the timeout, this test would hang/time out
    // rather than pass.
    sttClient.transcribeUtterance.mockResolvedValue("batch transcript");
    sttStreamClient.openIfNeeded(SESSION_ID, 48000, () => {});
    const ws = FakeWebSocket.instances[0];
    ws.open();
    sttStreamClient.sendChunk(SESSION_ID, samples(100));

    const promise = sttStreamClient.finishTranscription(SESSION_ID, Buffer.alloc(10), 48000);
    await Promise.resolve(); // let the commit message send synchronously inside finishTranscription

    ws.message({ message_type: "commit_throttled", error: "only 0.14s of uncommitted audio" });

    const result = await promise;
    expect(result).toBe("batch transcript");
  });

  test("falls back to batch if the committed transcript never arrives (timeout)", async () => {
    jest.useFakeTimers();
    sttClient.transcribeUtterance.mockResolvedValue("batch transcript");
    sttStreamClient.openIfNeeded(SESSION_ID, 48000, () => {});
    FakeWebSocket.instances[0].open();

    const promise = sttStreamClient.finishTranscription(SESSION_ID, Buffer.alloc(10), 48000);
    jest.advanceTimersByTime(8000);
    const result = await promise;

    expect(result).toBe("batch transcript");
    jest.useRealTimers();
  });

  test("closeSession is a safe no-op with nothing open", () => {
    expect(() => sttStreamClient.closeSession(SESSION_ID)).not.toThrow();
  });
});
