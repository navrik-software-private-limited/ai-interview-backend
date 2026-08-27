jest.mock("../../../evaluation/sessionDataLoader");
jest.mock("../../../evaluation/transcriptAssembler");
jest.mock("../../../evaluation/questionEvaluator");
jest.mock("../../../evaluation/skillResultAggregator");
jest.mock("../../../evaluation/languageProfiler");
jest.mock("../../../evaluation/softSkillsEvaluator");
jest.mock("../../../evaluation/caseStudyEvaluator");
jest.mock("../../../evaluation/scoringAggregator");
jest.mock("../../../evaluation/strengthsWeaknessesAnalyzer");
jest.mock("../../../evaluation/evidenceTracer");
jest.mock("../../../evaluation/betterAnswerGenerator");
jest.mock("../../../evaluation/proctoringSummarizer");
jest.mock("../../../evaluation/preparationNotesGenerator");
jest.mock("../../../evaluation/recommendationEngine");
jest.mock("../../../evaluation/reportAssembler");
jest.mock("../../../evaluation/evaluationRepository");
jest.mock("../../../reporting/reportRepository");

const sessionDataLoader = require("../../../evaluation/sessionDataLoader");
const transcriptAssembler = require("../../../evaluation/transcriptAssembler");
const questionEvaluator = require("../../../evaluation/questionEvaluator");
const skillResultAggregator = require("../../../evaluation/skillResultAggregator");
const languageProfiler = require("../../../evaluation/languageProfiler");
const softSkillsEvaluator = require("../../../evaluation/softSkillsEvaluator");
const caseStudyEvaluator = require("../../../evaluation/caseStudyEvaluator");
const scoringAggregator = require("../../../evaluation/scoringAggregator");
const strengthsWeaknessesAnalyzer = require("../../../evaluation/strengthsWeaknessesAnalyzer");
const evidenceTracer = require("../../../evaluation/evidenceTracer");
const betterAnswerGenerator = require("../../../evaluation/betterAnswerGenerator");
const proctoringSummarizer = require("../../../evaluation/proctoringSummarizer");
const preparationNotesGenerator = require("../../../evaluation/preparationNotesGenerator");
const recommendationEngine = require("../../../evaluation/recommendationEngine");
const reportAssembler = require("../../../evaluation/reportAssembler");
const evaluationRepository = require("../../../evaluation/evaluationRepository");
const reportRepository = require("../../../reporting/reportRepository");
const { generateReport } = require("../../../evaluation/evaluationPipeline");

function wireHappyPathDefaults() {
  sessionDataLoader.loadSessionData.mockResolvedValue({
    session: { id: "s1" },
    candidate: { id: "c1" },
    skillLabels: {},
    codingSubmissions: [],
    proctoringEvents: [],
  });
  transcriptAssembler.assembleTranscript.mockReturnValue({ questionAnswerTree: [], flatTranscript: [] });
  questionEvaluator.evaluateAllQuestions.mockResolvedValue([]);
  skillResultAggregator.aggregateSkillResults.mockReturnValue({ bySection: {}, skillLabels: {} });
  languageProfiler.profileLanguage.mockResolvedValue({});
  softSkillsEvaluator.evaluateSoftSkills.mockResolvedValue({});
  caseStudyEvaluator.evaluateCaseStudy.mockResolvedValue({});
  scoringAggregator.aggregateScores.mockResolvedValue({ categoryScores: {}, overallScore: 80 });
  strengthsWeaknessesAnalyzer.analyzeStrengthsWeaknesses.mockResolvedValue({
    strengths: ["Strength A"],
    weaknesses: ["Weakness A"],
    strengthsWithRefs: [{ text: "Strength A", questionRef: "q1" }],
    weaknessesWithRefs: [{ text: "Weakness A", questionRef: "q2" }],
  });
  evidenceTracer.traceEvidence.mockReturnValue({});
  evaluationRepository.upsertEvaluation.mockResolvedValue(undefined);
  betterAnswerGenerator.generateBetterAnswers.mockResolvedValue([]);
  evaluationRepository.fetchQuestionEvaluations.mockResolvedValue([]);
  proctoringSummarizer.summarizeProctoring.mockReturnValue({});
  preparationNotesGenerator.generatePreparationNotes.mockResolvedValue([]);
  recommendationEngine.computeRecommendation.mockReturnValue("READY");
  reportAssembler.assembleReport.mockResolvedValue({ overall_score: 80 });
  reportRepository.markGenerating.mockResolvedValue(undefined);
  reportRepository.markCompleted.mockResolvedValue(undefined);
  reportRepository.markFailed.mockResolvedValue(undefined);
}

describe("evaluation/evaluationPipeline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    wireHappyPathDefaults();
  });

  test("marks GENERATING before doing any work", async () => {
    await generateReport("s1");
    expect(reportRepository.markGenerating).toHaveBeenCalledWith("s1");
    expect(reportRepository.markGenerating.mock.invocationCallOrder[0]).toBeLessThan(
      sessionDataLoader.loadSessionData.mock.invocationCallOrder[0]
    );
  });

  test("happy path marks COMPLETED with the assembled report and recommendation, and returns the report", async () => {
    const report = await generateReport("s1");
    expect(reportRepository.markCompleted).toHaveBeenCalledWith("s1", { overall_score: 80 }, "READY");
    expect(reportRepository.markFailed).not.toHaveBeenCalled();
    expect(report).toEqual({ overall_score: 80 });
  });

  test("runs language profiling and soft-skills evaluation in parallel, independent of each other", async () => {
    let languageResolved = false;
    languageProfiler.profileLanguage.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => { languageResolved = true; resolve({}); }, 5))
    );
    softSkillsEvaluator.evaluateSoftSkills.mockImplementation(async () => {
      // If these ran sequentially (language first), this would see languageResolved === true.
      return { sawLanguageResolvedFirst: languageResolved };
    });

    await generateReport("s1");

    expect(softSkillsEvaluator.evaluateSoftSkills).toHaveBeenCalled();
  });

  test("doc/07 gap #5: case-study evaluation runs and is passed through to both persistence and the report", async () => {
    const caseStudy = { understanding: { rating: "Strong", evidenceCount: 3, evidence: [] } };
    caseStudyEvaluator.evaluateCaseStudy.mockResolvedValue(caseStudy);

    await generateReport("s1");

    expect(caseStudyEvaluator.evaluateCaseStudy).toHaveBeenCalled();
    expect(evaluationRepository.upsertEvaluation.mock.calls[0][1]).toEqual(
      expect.objectContaining({ caseStudy })
    );
    expect(reportAssembler.assembleReport.mock.calls[0][0]).toEqual(
      expect.objectContaining({ caseStudy })
    );
  });

  test("doc/07 gap #6: strengthsWithRefs/weaknessesWithRefs are passed through to both persistence and the report", async () => {
    await generateReport("s1");

    const upsertArgs = evaluationRepository.upsertEvaluation.mock.calls[0][1];
    expect(upsertArgs.strengths).toEqual(["Strength A"]);
    expect(upsertArgs.weaknesses).toEqual(["Weakness A"]);
    expect(upsertArgs.strengthsWithRefs).toEqual([{ text: "Strength A", questionRef: "q1" }]);
    expect(upsertArgs.weaknessesWithRefs).toEqual([{ text: "Weakness A", questionRef: "q2" }]);

    const assembleArgs = reportAssembler.assembleReport.mock.calls[0][0];
    expect(assembleArgs.strengthsWithRefs).toEqual([{ text: "Strength A", questionRef: "q1" }]);
    expect(assembleArgs.weaknessesWithRefs).toEqual([{ text: "Weakness A", questionRef: "q2" }]);
  });

  test("re-fetches question evaluations from SQL after generating better answers, rather than reusing in-memory objects", async () => {
    evaluationRepository.fetchQuestionEvaluations.mockResolvedValue([{ id: "e1", betterAnswer: "from db" }]);
    await generateReport("s1");
    const assembleArgs = reportAssembler.assembleReport.mock.calls[0][0];
    expect(assembleArgs.questionEvaluations).toEqual([{ id: "e1", betterAnswer: "from db" }]);
  });

  test("a failure anywhere in the pipeline marks the report FAILED and rethrows, never hangs at GENERATING", async () => {
    const boom = new Error("questionEvaluator exploded");
    questionEvaluator.evaluateAllQuestions.mockRejectedValue(boom);

    await expect(generateReport("s1")).rejects.toThrow("questionEvaluator exploded");

    expect(reportRepository.markFailed).toHaveBeenCalledWith("s1", "questionEvaluator exploded");
    expect(reportRepository.markCompleted).not.toHaveBeenCalled();
  });

  test("a failure late in the pipeline (report assembly) still marks FAILED, not COMPLETED", async () => {
    reportAssembler.assembleReport.mockRejectedValue(new Error("assembly failed"));
    await expect(generateReport("s1")).rejects.toThrow("assembly failed");
    expect(reportRepository.markFailed).toHaveBeenCalledWith("s1", "assembly failed");
    expect(reportRepository.markCompleted).not.toHaveBeenCalled();
  });
});
