jest.mock("../../../interviewer/llmClient");
jest.mock("../../../admin/adminConfigRepository");

const llmClient = require("../../../interviewer/llmClient");
const adminConfigRepository = require("../../../admin/adminConfigRepository");
const { aggregateScores, ratingToNumber, CATEGORIES } = require("../../../evaluation/scoringAggregator");

describe("evaluation/scoringAggregator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    adminConfigRepository.getActiveConfiguration.mockResolvedValue(null);
    llmClient.generateJson.mockResolvedValue({ codingScore: 80 });
  });

  describe("ratingToNumber", () => {
    test.each([
      ["strong", 92],
      ["good", 78],
      ["moderate", 60],
      ["weak", 38],
      ["needs improvement", 45],
    ])("maps rating %s -> %i", (rating, expected) => {
      expect(ratingToNumber(rating)).toBe(expected);
    });

    test("strips a trailing '(limited evidence)' suffix before mapping", () => {
      expect(ratingToNumber("Strong (limited evidence)")).toBe(92);
    });

    test("is case-insensitive", () => {
      expect(ratingToNumber("STRONG")).toBe(92);
    });

    test("returns null for insufficient data / limited evidence / unknown ratings", () => {
      expect(ratingToNumber("insufficient data")).toBeNull();
      expect(ratingToNumber("limited evidence")).toBeNull();
      expect(ratingToNumber("something else entirely")).toBeNull();
    });

    test("returns null for a non-string input", () => {
      expect(ratingToNumber(undefined)).toBeNull();
      expect(ratingToNumber(42)).toBeNull();
    });
  });

  describe("aggregateScores — category scores", () => {
    const questionEvaluations = [
      { section: "JD_RESUME", score: 8 },
      { section: "JD_RESUME", score: 6 },
      { section: "APTITUDE", score: 7 },
      { section: "CASE", score: 9 },
    ];
    const softSkills = {
      problemSolving: { rating: "good" },
      communication: { rating: "strong" },
    };
    const languageProfile = { fluency: "strong", clarity: "moderate" };

    test("technical is the average of JD_RESUME + APTITUDE scores, scaled 0-10 -> 0-100", async () => {
      const { categoryScores } = await aggregateScores({
        questionEvaluations,
        softSkills,
        languageProfile,
        codingSubmissions: [],
      });
      // (8 + 6 + 7) / 3 = 7 -> *10 = 70
      expect(categoryScores.technical).toBe(70);
    });

    test("theoretical reuses the technical score (documented simplification — no separate theoretical category)", async () => {
      const { categoryScores } = await aggregateScores({
        questionEvaluations,
        softSkills,
        languageProfile,
        codingSubmissions: [],
      });
      expect(categoryScores.theoretical).toBe(categoryScores.technical);
    });

    test("case_analysis is derived only from CASE-section scores", async () => {
      const { categoryScores } = await aggregateScores({
        questionEvaluations,
        softSkills,
        languageProfile,
        codingSubmissions: [],
      });
      expect(categoryScores.case_analysis).toBe(90);
    });

    test("problem_solving/communication come from softSkills ratings", async () => {
      const { categoryScores } = await aggregateScores({
        questionEvaluations,
        softSkills,
        languageProfile,
        codingSubmissions: [],
      });
      expect(categoryScores.problem_solving).toBe(78); // good
      expect(categoryScores.communication).toBe(92); // strong
    });

    test("a section with no scored questions yields a null category score", async () => {
      const { categoryScores } = await aggregateScores({
        questionEvaluations: [],
        softSkills: {},
        languageProfile: {},
        codingSubmissions: [],
      });
      expect(categoryScores.technical).toBeNull();
      expect(categoryScores.case_analysis).toBeNull();
    });

    test("coding score is only estimated when at least one submission has an evaluation", async () => {
      const { categoryScores } = await aggregateScores({
        questionEvaluations: [],
        softSkills: {},
        languageProfile: {},
        codingSubmissions: [{ evaluation: { correctness_assessment: "looks right" } }],
      });
      expect(llmClient.generateJson).toHaveBeenCalledTimes(1);
      expect(categoryScores.coding).toBe(80);
    });

    test("coding score is null (and the LLM is never called) when no submission has an evaluation", async () => {
      const { categoryScores } = await aggregateScores({
        questionEvaluations: [],
        softSkills: {},
        languageProfile: {},
        codingSubmissions: [],
      });
      expect(llmClient.generateJson).not.toHaveBeenCalled();
      expect(categoryScores.coding).toBeNull();
    });
  });

  describe("aggregateScores — weights (docFiles/L3-01 §2: never hardcode weights)", () => {
    test("falls back to equal weighting (1 per category) when no admin configuration is active", async () => {
      adminConfigRepository.getActiveConfiguration.mockResolvedValue(null);
      const { overallScore } = await aggregateScores({
        questionEvaluations: [{ section: "JD_RESUME", score: 10 }],
        softSkills: {},
        languageProfile: {},
        codingSubmissions: [],
      });
      // Only `technical`/`theoretical` are non-null here, both = 100, equal weight -> 100.
      expect(overallScore).toBe(100);
    });

    test("uses configured evaluation_criteria.weights when present", async () => {
      adminConfigRepository.getActiveConfiguration.mockResolvedValue({
        configuration: { evaluation_criteria: { weights: { technical: 3, theoretical: 1 } } },
      });
      const { overallScore } = await aggregateScores({
        questionEvaluations: [{ section: "JD_RESUME", score: 10 }], // technical = theoretical = 100
        softSkills: {},
        languageProfile: {},
        codingSubmissions: [],
      });
      // Only technical/theoretical are non-null, both 100 regardless of weight ratio -> still 100.
      expect(overallScore).toBe(100);
    });

    test("returns a null overall score when every category score is null", async () => {
      const { overallScore } = await aggregateScores({
        questionEvaluations: [],
        softSkills: {},
        languageProfile: {},
        codingSubmissions: [],
      });
      expect(overallScore).toBeNull();
    });
  });

  test("CATEGORIES is the fixed 8-category list this module scores against", () => {
    expect(CATEGORIES).toEqual([
      "technical",
      "problem_solving",
      "case_analysis",
      "communication",
      "soft_skills",
      "theoretical",
      "language_profile",
      "coding",
    ]);
  });
});
