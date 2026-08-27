jest.mock("../../../interviewer/llmClient");
const llmClient = require("../../../interviewer/llmClient");
const { buildGreeting } = require("../../../question-engine/greeting");

const STATIC_GREETING =
  "Hi, welcome to your PractiWiz AI interview. I'm your AI interviewer today. To get started, could you tell me a little about yourself?";

describe("question-engine/greeting.buildGreeting", () => {
  beforeEach(() => jest.clearAllMocks());

  test("doc/07 gap #9: falls back to the original static greeting when there's no name or resume context, and it's cacheable", async () => {
    const result = await buildGreeting({});

    expect(llmClient.generateReply).not.toHaveBeenCalled();
    expect(result).toEqual({ text: STATIC_GREETING, cacheable: true });
  });

  test("defaults to the static fallback when called with no args at all", async () => {
    const result = await buildGreeting();
    expect(result).toEqual({ text: STATIC_GREETING, cacheable: true });
  });

  test("generates an LLM-personalized greeting when a candidate name is available, and marks it non-cacheable", async () => {
    llmClient.generateReply.mockResolvedValue("Hi Priya, great to have you here! Tell me about yourself.");

    const result = await buildGreeting({ candidateName: "Priya" });

    expect(llmClient.generateReply).toHaveBeenCalledWith([], expect.stringContaining("Priya"), expect.anything());
    expect(result).toEqual({ text: "Hi Priya, great to have you here! Tell me about yourself.", cacheable: false });
  });

  test("generates an LLM-personalized greeting when resume context has real signal, even with no name", async () => {
    llmClient.generateReply.mockResolvedValue("Welcome! I see you have strong React experience.");
    const resumeContext = { skills: ["React", "Node.js"], role_requirements: [], knowledge_areas: [] };

    const result = await buildGreeting({ resumeContext });

    expect(llmClient.generateReply).toHaveBeenCalled();
    expect(result.cacheable).toBe(false);
  });

  test("does not call the LLM when resumeContext exists but every array is empty", async () => {
    const resumeContext = { skills: [], experience_claims: [], role_requirements: [], knowledge_areas: [], question_targets: [] };

    const result = await buildGreeting({ resumeContext });

    expect(llmClient.generateReply).not.toHaveBeenCalled();
    expect(result).toEqual({ text: STATIC_GREETING, cacheable: true });
  });

  test("falls back to a name-only template (not the LLM output) when the LLM call throws", async () => {
    llmClient.generateReply.mockRejectedValue(new Error("LLM down"));

    const result = await buildGreeting({ candidateName: "Priya" });

    expect(result.cacheable).toBe(false);
    expect(result.text).toContain("Priya");
    expect(result.text).not.toContain("LLM down");
  });

  test("falls back to a name-only template when the LLM returns an empty string", async () => {
    llmClient.generateReply.mockResolvedValue("");

    const result = await buildGreeting({ candidateName: "Priya" });

    expect(result.text).toContain("Priya");
    expect(result.cacheable).toBe(false);
  });
});
