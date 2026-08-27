jest.mock("../../../interviewer/llmClient");
const llmClient = require("../../../interviewer/llmClient");
const { analyzeStrengthsWeaknesses } = require("../../../evaluation/strengthsWeaknessesAnalyzer");

describe("evaluation/strengthsWeaknessesAnalyzer", () => {
  beforeEach(() => jest.clearAllMocks());

  const baseInput = { questionEvaluations: [], softSkills: {}, languageProfile: {} };

  test("keeps bullets that have a non-empty questionRef", async () => {
    llmClient.generateJson.mockResolvedValue({
      strengths: [{ text: "Strong system design instincts", questionRef: "q1" }],
      weaknesses: [{ text: "Database indexing needs work", questionRef: "q2" }],
    });

    const result = await analyzeStrengthsWeaknesses(baseInput);

    expect(result.strengths).toEqual(["Strong system design instincts"]);
    expect(result.weaknesses).toEqual(["Database indexing needs work"]);
  });

  test("drops any bullet missing a questionRef (docFiles/L3-01 §3/§4 auditability rule)", async () => {
    llmClient.generateJson.mockResolvedValue({
      strengths: [
        { text: "Has a ref", questionRef: "q1" },
        { text: "No ref at all" },
        { text: "Empty ref", questionRef: "" },
      ],
      weaknesses: [],
    });

    const result = await analyzeStrengthsWeaknesses(baseInput);

    expect(result.strengths).toEqual(["Has a ref"]);
  });

  test("drops a bullet with an empty/whitespace-only text", async () => {
    llmClient.generateJson.mockResolvedValue({
      strengths: [{ text: "   ", questionRef: "q1" }],
      weaknesses: [],
    });

    const result = await analyzeStrengthsWeaknesses(baseInput);

    expect(result.strengths).toEqual([]);
  });

  test("still returns the ref-carrying arrays alongside the plain-text ones", async () => {
    llmClient.generateJson.mockResolvedValue({
      strengths: [{ text: "Strong", questionRef: "q1" }],
      weaknesses: [],
    });

    const result = await analyzeStrengthsWeaknesses(baseInput);

    expect(result.strengthsWithRefs).toEqual([{ text: "Strong", questionRef: "q1" }]);
    expect(result.weaknessesWithRefs).toEqual([]);
  });

  test("handles a non-compliant (null) LLM response without throwing", async () => {
    llmClient.generateJson.mockResolvedValue(null);
    const result = await analyzeStrengthsWeaknesses(baseInput);
    expect(result).toEqual({ strengths: [], weaknesses: [], strengthsWithRefs: [], weaknessesWithRefs: [] });
  });
});
