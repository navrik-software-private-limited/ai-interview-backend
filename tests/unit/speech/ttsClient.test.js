const { EventEmitter } = require("events");

jest.mock("axios");
jest.mock("../../../config/env", () => ({
  elevenLabs: { apiKey: "test-key", ttsVoiceId: "voice-1", ttsModelId: "model-1" },
}));

const axios = require("axios");
const ttsClient = require("../../../speech/ttsClient");

describe("speech/ttsClient.synthesizeSpeech", () => {
  beforeEach(() => jest.clearAllMocks());

  test("forwards signal to axios", async () => {
    axios.post.mockResolvedValue({ data: Buffer.alloc(10) });
    const signal = new AbortController().signal;

    await ttsClient.synthesizeSpeech("hello", { signal });

    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ signal })
    );
  });
});

describe("speech/ttsClient.synthesizeSpeechStreaming", () => {
  beforeEach(() => jest.clearAllMocks());

  function fakeStreamResponse() {
    const stream = new EventEmitter();
    stream.destroy = jest.fn();
    return { data: stream, stream };
  }

  // synthesizeSpeechStreaming awaits axios.post() (a microtask) before it
  // ever attaches the stream's event listeners — emitting an event before
  // that await resolves would be lost (nothing listening yet). One
  // Promise.resolve() tick is enough to let it get there.
  async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
  }

  test("forwards signal to axios", async () => {
    const { data: stream, stream: streamRef } = fakeStreamResponse();
    axios.post.mockResolvedValue({ data: stream });
    const signal = new AbortController().signal;

    const promise = ttsClient.synthesizeSpeechStreaming("hello", null, { signal });
    await flushMicrotasks();
    streamRef.emit("end");
    await promise;

    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ signal })
    );
  });

  test("doc/real_time_interview_communication_improvement.md Phase 3: rejects with an AbortError as soon as the signal is aborted, even mid-stream", async () => {
    const { data: stream, stream: streamRef } = fakeStreamResponse();
    axios.post.mockResolvedValue({ data: stream });
    const controller = new AbortController();

    const promise = ttsClient.synthesizeSpeechStreaming("hello", null, { signal: controller.signal });
    await flushMicrotasks();
    controller.abort();

    await expect(promise).rejects.toThrow();
    expect(streamRef.destroy).toHaveBeenCalled();
  });

  test("resolves normally with the concatenated buffer when never aborted", async () => {
    const { data: stream, stream: streamRef } = fakeStreamResponse();
    axios.post.mockResolvedValue({ data: stream });
    const chunks = [];

    const promise = ttsClient.synthesizeSpeechStreaming("hello", (c) => chunks.push(c));
    await flushMicrotasks();
    streamRef.emit("data", Buffer.alloc(100));
    streamRef.emit("end");

    const result = await promise;
    expect(result).toBeInstanceOf(Buffer);
    expect(chunks.length).toBeGreaterThan(0);
  });
});
