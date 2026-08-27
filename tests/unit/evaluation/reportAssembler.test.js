jest.mock("../../../interviewer/llmClient");
const llmClient = require("../../../interviewer/llmClient");
const { assembleReport } = require("../../../evaluation/reportAssembler");

function baseArgs(overrides = {}) {
  return {
    session: { id: "s1", interviewId: "i1", startedAt: "t0", endedAt: "t1", completionReason: "interview_completed" },
    candidate: { id: "c1", name: "Test Candidate" },
    questionEvaluations: [],
    skillResults: { bySection: {}, skillLabels: {} },
    softSkills: {},
    languageProfile: {},
    codingSubmissions: [],
    categoryScores: {},
    overallScore: null,
    strengths: [],
    weaknesses: [],
    evidenceTrace: {},
    flatTranscript: [],
    proctoringSummary: {},
    preparationNotes: [],
    recommendation: "NEEDS_IMPROVEMENT",
    ...overrides,
  };
}

describe("evaluation/reportAssembler", () => {
  beforeEach(() => jest.clearAllMocks());

  test("empty strengths/weaknesses/arrays become 'Insufficient data' (docFiles/L3-05 §4: never silently omitted)", async () => {
    llmClient.generateJson.mockResolvedValue({ executiveSummary: "summary" });
    const report = await assembleReport(baseArgs());

    expect(report.strengths).toBe("Insufficient data");
    expect(report.weaknesses).toBe("Insufficient data");
    expect(report.transcript).toBe("Insufficient data");
    expect(report.proctoring_summary).toBe("Insufficient data");
  });

  test("doc/07 gap #5: case_study_evaluation.dimensions reflects the passed-in caseStudy, or 'Insufficient data' when absent", async () => {
    llmClient.generateJson.mockResolvedValue({ executiveSummary: "s" });

    const withoutCaseStudy = await assembleReport(baseArgs());
    expect(withoutCaseStudy.case_study_evaluation.dimensions).toBe("Insufficient data");

    const caseStudy = { understanding: { rating: "Strong", evidenceCount: 3, evidence: [] } };
    const withCaseStudy = await assembleReport(baseArgs({ caseStudy }));
    expect(withCaseStudy.case_study_evaluation.dimensions).toEqual(caseStudy);
  });

  test("doc/07 gap #6: strengths_evidence/weaknesses_evidence reflect the passed-in refs, or 'Insufficient data' when absent", async () => {
    llmClient.generateJson.mockResolvedValue({ executiveSummary: "s" });

    const withoutRefs = await assembleReport(baseArgs());
    expect(withoutRefs.strengths_evidence).toBe("Insufficient data");
    expect(withoutRefs.weaknesses_evidence).toBe("Insufficient data");

    const strengthsWithRefs = [{ text: "Strong communicator", questionRef: "q1" }];
    const weaknessesWithRefs = [{ text: "Weak on trade-offs", questionRef: "q2" }];
    const withRefs = await assembleReport(baseArgs({ strengthsWithRefs, weaknessesWithRefs }));
    expect(withRefs.strengths_evidence).toEqual(strengthsWithRefs);
    expect(withRefs.weaknesses_evidence).toEqual(weaknessesWithRefs);
  });

  test("a null candidate/session field also becomes 'Insufficient data'", async () => {
    llmClient.generateJson.mockResolvedValue({ executiveSummary: "summary" });
    const report = await assembleReport(baseArgs({ candidate: null }));
    expect(report.candidate_information).toBe("Insufficient data");
  });

  test("non-empty values pass through untouched", async () => {
    llmClient.generateJson.mockResolvedValue({ executiveSummary: "summary" });
    const report = await assembleReport(baseArgs({ strengths: ["Strong communicator"] }));
    expect(report.strengths).toEqual(["Strong communicator"]);
  });

  test("falls back to a deterministic executive summary when the LLM doesn't comply", async () => {
    llmClient.generateJson.mockResolvedValue(null);
    const report = await assembleReport(baseArgs({ overallScore: 72, recommendation: "READY" }));
    expect(report.executive_summary).toBe("Overall score: 72/100. Recommendation: READY.");
  });

  test("assembles betterAnswerSuggestions only from questions that have one", async () => {
    llmClient.generateJson.mockResolvedValue({ executiveSummary: "s" });
    const report = await assembleReport(
      baseArgs({
        questionEvaluations: [
          { questionAskedId: "q1", section: "JD_RESUME", questionText: "Q1", answerText: "A1", betterAnswer: "Better!" },
          { questionAskedId: "q2", section: "JD_RESUME", questionText: "Q2", answerText: "A2" },
        ],
      })
    );
    expect(report.better_answer_suggestions).toEqual([
      { questionAskedId: "q1", section: "JD_RESUME", questionText: "Q1", candidateAnswer: "A1", betterAnswer: "Better!" },
    ]);
  });

  test("includes every one of the 19 documented report sections", async () => {
    llmClient.generateJson.mockResolvedValue({ executiveSummary: "s" });
    const report = await assembleReport(baseArgs());
    const expectedKeys = [
      "candidate_information",
      "interview_information",
      "overall_score",
      "executive_summary",
      "strengths",
      "weaknesses",
      "technical_skills_evaluation",
      "aptitude_evaluation",
      "case_study_evaluation",
      "coding_evaluation",
      "theoretical_knowledge",
      "soft_skills",
      "language_profile",
      "question_by_question_analysis",
      "transcript",
      "better_answer_suggestions",
      "proctoring_summary",
      "preparation_notes",
      "final_recommendation",
    ];
    for (const key of expectedKeys) {
      expect(report).toHaveProperty(key);
    }
  });
});
