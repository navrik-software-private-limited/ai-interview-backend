jest.mock("../../../interviewer/llmClient");
const llmClient = require("../../../interviewer/llmClient");
const { evaluateCaseStudy, DIMENSIONS } = require("../../../evaluation/caseStudyEvaluator");

describe("evaluation/caseStudyEvaluator", () => {
  beforeEach(() => jest.clearAllMocks());

  test("DIMENSIONS covers the 6 dimensions from doc 04 §7", () => {
    expect(DIMENSIONS).toEqual([
      "understanding",
      "approach",
      "reasoning",
      "tradeoffs",
      "technicalBusinessThinking",
      "communication",
    ]);
  });

  test("returns 'Insufficient data' for every dimension, with no LLM call, when there are no CASE questions", async () => {
    const result = await evaluateCaseStudy([
      { section: "JD_RESUME", questionText: "Q1", answerText: "A1" },
      { section: "APTITUDE", questionText: "Q2", answerText: "A2" },
    ]);

    expect(llmClient.generateJson).not.toHaveBeenCalled();
    for (const dimension of DIMENSIONS) {
      expect(result[dimension]).toEqual({ rating: "Insufficient data", evidenceCount: 0, evidence: [] });
    }
  });

  test("returns 'Insufficient data' for an empty/undefined questionEvaluations input", async () => {
    const result = await evaluateCaseStudy([]);
    expect(llmClient.generateJson).not.toHaveBeenCalled();
    expect(result.understanding.rating).toBe("Insufficient data");

    const result2 = await evaluateCaseStudy(undefined);
    expect(result2.understanding.rating).toBe("Insufficient data");
  });

  test("only CASE-section questions are sent to the LLM prompt", async () => {
    llmClient.generateJson.mockResolvedValue({});
    await evaluateCaseStudy([
      { section: "JD_RESUME", questionText: "Not a case question", answerText: "irrelevant" },
      { section: "CASE", questionText: "Case Q1", answerText: "Case A1" },
    ]);

    const prompt = llmClient.generateJson.mock.calls[0][0];
    expect(prompt).toContain("Case Q1");
    expect(prompt).not.toContain("Not a case question");
  });

  test("applies the LLM's ratings and evidence-threshold enforcement per dimension", async () => {
    llmClient.generateJson.mockResolvedValue({
      understanding: { rating: "Strong", evidenceCount: 3, evidence: [{ note: "grasped the core trade-off" }] },
      approach: { rating: "Good", evidenceCount: 1, evidence: [{ note: "reasonable structure" }] },
    });

    const result = await evaluateCaseStudy([{ section: "CASE", questionText: "Q", answerText: "A" }]);

    expect(result.understanding).toEqual({
      rating: "Strong",
      evidenceCount: 3,
      evidence: [{ note: "grasped the core trade-off" }],
    });
    // evidenceCount 1 < MIN_EVIDENCE_COUNT (2) -> evidenceThreshold suffixes the rating.
    expect(result.approach.rating).toBe("Good (limited evidence)");
  });

  test("falls back to 'Limited evidence' for a dimension missing from the LLM response", async () => {
    llmClient.generateJson.mockResolvedValue({ understanding: { rating: "Strong", evidenceCount: 3, evidence: [] } });

    const result = await evaluateCaseStudy([{ section: "CASE", questionText: "Q", answerText: "A" }]);

    expect(result.reasoning).toEqual({ rating: "Limited evidence", evidenceCount: 0, evidence: [] });
  });

  test("handles a non-compliant (null) LLM response without throwing", async () => {
    llmClient.generateJson.mockResolvedValue(null);
    const result = await evaluateCaseStudy([{ section: "CASE", questionText: "Q", answerText: "A" }]);
    for (const dimension of DIMENSIONS) {
      expect(result[dimension].rating).toBe("Limited evidence");
    }
  });
});
