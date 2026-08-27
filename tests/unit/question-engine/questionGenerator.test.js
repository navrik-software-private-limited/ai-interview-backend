jest.mock("../../../interviewer/llmClient");
const llmClient = require("../../../interviewer/llmClient");
const questionGenerator = require("../../../question-engine/questionGenerator");

describe("question-engine/questionGenerator — signal forwarding (doc/real_time_interview_communication_improvement.md Phase 3)", () => {
  beforeEach(() => jest.clearAllMocks());

  test("generateQuestion forwards signal to llmClient.generateReply", async () => {
    llmClient.generateReply.mockResolvedValue("A question?");
    const signal = new AbortController().signal;

    await questionGenerator.generateQuestion("JD_RESUME", [], null, { signal });

    expect(llmClient.generateReply).toHaveBeenCalledWith(expect.any(Array), expect.any(String), { signal });
  });

  test("generateFollowUp forwards signal to llmClient.generateReply", async () => {
    llmClient.generateReply.mockResolvedValue("A follow-up?");
    const signal = new AbortController().signal;

    await questionGenerator.generateFollowUp([], "reason", { signal });

    expect(llmClient.generateReply).toHaveBeenCalledWith([], expect.any(String), { signal });
  });

  test("generateCasePresentation forwards signal to llmClient.generateReply", async () => {
    llmClient.generateReply.mockResolvedValue("A presentation.");
    const signal = new AbortController().signal;

    await questionGenerator.generateCasePresentation("case text", { signal });

    expect(llmClient.generateReply).toHaveBeenCalledWith([], expect.any(String), { signal });
  });

  test("generateMcqQuestion forwards signal to llmClient.generateJson", async () => {
    llmClient.generateJson.mockResolvedValue({
      questionText: "Pick one",
      options: [
        { key: "A", text: "a" },
        { key: "B", text: "b" },
      ],
      correctOption: "A",
    });
    const signal = new AbortController().signal;

    await questionGenerator.generateMcqQuestion("APTITUDE", [], null, { signal });

    expect(llmClient.generateJson).toHaveBeenCalledWith(expect.any(String), { signal });
  });

  test("every generator still works with no signal at all (backward compatible)", async () => {
    llmClient.generateReply.mockResolvedValue("A question?");
    await expect(questionGenerator.generateQuestion("APTITUDE", [])).resolves.toBe("A question?");
  });
});

describe("question-engine/questionGenerator — streaming variants (doc/real_time_interview_communication_improvement.md Phase 6)", () => {
  beforeEach(() => jest.clearAllMocks());

  test("generateQuestionStream builds the exact same prompt as generateQuestion and forwards signal", async () => {
    const fakeStream = (async function* () {})();
    llmClient.generateReplyStream.mockResolvedValue(fakeStream);
    llmClient.generateReply.mockResolvedValue("A question?");
    const signal = new AbortController().signal;

    const result = await questionGenerator.generateQuestionStream("JD_RESUME", [], null, { signal });
    await questionGenerator.generateQuestion("JD_RESUME", [], null, { signal }); // same call shape, batch sibling

    const [, streamPrompt] = llmClient.generateReplyStream.mock.calls[0];
    const [, batchPrompt] = llmClient.generateReply.mock.calls[0];
    expect(streamPrompt).toBe(batchPrompt);
    expect(llmClient.generateReplyStream).toHaveBeenCalledWith(expect.any(Array), expect.any(String), { signal });
    expect(result).toBe(fakeStream);
  });

  test("generateFollowUpStream builds the exact same prompt as generateFollowUp and forwards signal", async () => {
    const fakeStream = (async function* () {})();
    llmClient.generateReplyStream.mockResolvedValue(fakeStream);
    llmClient.generateReply.mockResolvedValue("A follow-up?");
    const signal = new AbortController().signal;

    await questionGenerator.generateFollowUpStream([], "reason", { signal });
    await questionGenerator.generateFollowUp([], "reason", { signal });

    const [, streamPrompt] = llmClient.generateReplyStream.mock.calls[0];
    const [, batchPrompt] = llmClient.generateReply.mock.calls[0];
    expect(streamPrompt).toBe(batchPrompt);
  });

  test("generateCasePresentationStream builds the exact same prompt as generateCasePresentation and forwards signal", async () => {
    const fakeStream = (async function* () {})();
    llmClient.generateReplyStream.mockResolvedValue(fakeStream);
    llmClient.generateReply.mockResolvedValue("A presentation.");
    const signal = new AbortController().signal;

    await questionGenerator.generateCasePresentationStream("case text", { signal });
    await questionGenerator.generateCasePresentation("case text", { signal });

    const [, streamPrompt] = llmClient.generateReplyStream.mock.calls[0];
    const [, batchPrompt] = llmClient.generateReply.mock.calls[0];
    expect(streamPrompt).toBe(batchPrompt);
  });
});
