const mockInvoke = jest.fn();
const mockStream = jest.fn();
jest.mock("@langchain/openai", () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({ invoke: mockInvoke, stream: mockStream })),
}));
jest.mock("../../../config/env", () => ({
  openai: { apiKey: "test-key", model: "gpt-4o-mini", requestTimeoutMs: 5000 },
}));

const llmClient = require("../../../interviewer/llmClient");

describe("interviewer/llmClient", () => {
  beforeEach(() => jest.clearAllMocks());

  test("generateReply forwards signal to model.invoke", async () => {
    mockInvoke.mockResolvedValue({ content: "hello" });
    const signal = new AbortController().signal;

    const result = await llmClient.generateReply([], "system prompt", { signal });

    expect(mockInvoke).toHaveBeenCalledWith(expect.any(Array), { signal });
    expect(result).toBe("hello");
  });

  test("generateReply works with no signal at all (backward compatible)", async () => {
    mockInvoke.mockResolvedValue({ content: "hello" });
    await expect(llmClient.generateReply([], "system prompt")).resolves.toBe("hello");
    expect(mockInvoke).toHaveBeenCalledWith(expect.any(Array), { signal: undefined });
  });

  test("generateJson forwards signal to jsonModel.invoke", async () => {
    mockInvoke.mockResolvedValue({ content: '{"ok":true}' });
    const signal = new AbortController().signal;

    const result = await llmClient.generateJson("prompt", { signal });

    expect(mockInvoke).toHaveBeenCalledWith(expect.any(Array), { signal });
    expect(result).toEqual({ ok: true });
  });

  test("generateJson still returns null (not throws) on a non-abort failure", async () => {
    mockInvoke.mockRejectedValue(new Error("model exploded"));
    const result = await llmClient.generateJson("prompt");
    expect(result).toBeNull();
  });

  test("doc/real_time_interview_communication_improvement.md Phase 3: generateJson rethrows (does not swallow into null) when the signal was aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    mockInvoke.mockRejectedValue(abortError);

    await expect(llmClient.generateJson("prompt", { signal: controller.signal })).rejects.toThrow("aborted");
  });

  describe("doc/real_time_interview_communication_improvement.md Phase 6: generateReplyStream", () => {
    test("forwards signal to model.stream and returns the raw stream", async () => {
      async function* fakeStream() {
        yield { content: "Hello" };
        yield { content: " world" };
      }
      const stream = fakeStream();
      mockStream.mockResolvedValue(stream);
      const signal = new AbortController().signal;

      const result = await llmClient.generateReplyStream([], "system prompt", { signal });

      expect(mockStream).toHaveBeenCalledWith(expect.any(Array), { signal });
      expect(result).toBe(stream);
    });

    test("chunks are consumable via for-await and accumulate correctly", async () => {
      async function* fakeStream() {
        yield { content: "Hello" };
        yield { content: " world" };
      }
      mockStream.mockResolvedValue(fakeStream());

      const stream = await llmClient.generateReplyStream([], "system prompt");
      let text = "";
      for await (const chunk of stream) text += chunk.content;

      expect(text).toBe("Hello world");
    });
  });

  describe("doc/real_time_interview_communication_improvement.md Phase 9: request timeout", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test("generateReply rejects (not hangs) once a request never resolves within requestTimeoutMs", async () => {
      mockInvoke.mockReturnValue(new Promise(() => {})); // never resolves
      const assertion = expect(llmClient.generateReply([], "system prompt")).rejects.toThrow(/timed out/);
      await jest.advanceTimersByTimeAsync(5000);
      await assertion;
    });

    test("generateReply's timeout is a plain Error, not treated as an abort", async () => {
      mockInvoke.mockReturnValue(new Promise(() => {}));
      const assertion = expect(llmClient.generateReply([], "system prompt")).rejects.toHaveProperty("name", "Error");
      await jest.advanceTimersByTimeAsync(5000);
      await assertion;
    });

    test("generateJson resolves to null (its existing non-abort failure contract) on timeout instead of hanging", async () => {
      mockInvoke.mockReturnValue(new Promise(() => {}));
      const assertion = expect(llmClient.generateJson("prompt")).resolves.toBeNull();
      await jest.advanceTimersByTimeAsync(5000);
      await assertion;
    });

    test("generateReplyStream rejects (not hangs) when the initial stream connect never resolves", async () => {
      mockStream.mockReturnValue(new Promise(() => {}));
      const assertion = expect(llmClient.generateReplyStream([], "system prompt")).rejects.toThrow(/timed out/);
      await jest.advanceTimersByTimeAsync(5000);
      await assertion;
    });
  });
});
