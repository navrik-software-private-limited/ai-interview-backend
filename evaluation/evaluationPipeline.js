const logger = require("../logs/logger");
const sessionDataLoader = require("./sessionDataLoader");
const transcriptAssembler = require("./transcriptAssembler");
const questionEvaluator = require("./questionEvaluator");
const skillResultAggregator = require("./skillResultAggregator");
const languageProfiler = require("./languageProfiler");
const softSkillsEvaluator = require("./softSkillsEvaluator");
const scoringAggregator = require("./scoringAggregator");
const strengthsWeaknessesAnalyzer = require("./strengthsWeaknessesAnalyzer");
const evidenceTracer = require("./evidenceTracer");
const betterAnswerGenerator = require("./betterAnswerGenerator");
const proctoringSummarizer = require("./proctoringSummarizer");
const preparationNotesGenerator = require("./preparationNotesGenerator");
const recommendationEngine = require("./recommendationEngine");
const reportAssembler = require("./reportAssembler");
const evaluationRepository = require("./evaluationRepository");
const reportRepository = require("../reporting/reportRepository");

// docFiles/L3-01..L3-05: the single orchestration entrypoint, one call per
// completed session. Run in dependency order (docFiles/99-MVP-AND-ROADMAP.md
// §6's own build order 8: "L3-01, L3-02, L3-03, L3-04, L3-05 -> full report
// pipeline"), with language/soft-skills run in parallel since they're
// independent of each other.
//
// The whole pipeline is wrapped in one top-level try/catch that marks the
// report FAILED on any exception — a report must never get stuck at
// GENERATING silently forever, matching the tiered-fallback/never-hang
// philosophy already established elsewhere in this codebase (e.g.
// interviewer/interviewController.js's speak()).
async function generateReport(sessionId) {
  await reportRepository.markGenerating(sessionId);

  try {
    const data = await sessionDataLoader.loadSessionData(sessionId);

    const { questionAnswerTree, flatTranscript } = transcriptAssembler.assembleTranscript(data);

    // Step 3 (L3-03): per-question technical/theoretical evaluation.
    const questionEvaluations = await questionEvaluator.evaluateAllQuestions(sessionId, questionAnswerTree);

    // Step 4: pure-JS per-section skill rollup.
    const skillResults = skillResultAggregator.aggregateSkillResults(questionEvaluations, data.skillLabels);

    // Steps 5-6 (L3-02): independent of each other and of the coding score,
    // safe to run in parallel.
    const [languageProfile, softSkills] = await Promise.all([
      languageProfiler.profileLanguage(flatTranscript),
      softSkillsEvaluator.evaluateSoftSkills(flatTranscript, questionEvaluations),
    ]);

    // Step 7 (L3-01 §2): category scores + overall score.
    const { categoryScores, overallScore } = await scoringAggregator.aggregateScores({
      questionEvaluations,
      softSkills,
      languageProfile,
      codingSubmissions: data.codingSubmissions,
    });

    // Step 8 (L3-01 §3/§4): evidence-grounded strengths/weaknesses.
    const { strengths, weaknesses } = await strengthsWeaknessesAnalyzer.analyzeStrengthsWeaknesses({
      questionEvaluations,
      softSkills,
      languageProfile,
    });

    // Step 9 (L3-01 §5): pure-JS evidence trace.
    const evidenceTrace = evidenceTracer.traceEvidence(questionEvaluations);

    await evaluationRepository.upsertEvaluation(sessionId, {
      overallScore,
      categoryScores,
      skillResults: skillResults.bySection,
      evidenceTrace,
      strengths,
      weaknesses,
      languageProfile,
      softSkills,
    });

    // Step 10 (L3-04 §2): writes better_answer back onto each question
    // evaluation row directly — re-fetch fresh from SQL afterward rather
    // than threading the mutation through in-memory objects, so the
    // assembler always reads the single persisted source of truth.
    await betterAnswerGenerator.generateBetterAnswers(questionEvaluations);
    const questionEvaluationsWithBetterAnswers = await evaluationRepository.fetchQuestionEvaluations(sessionId);

    // Step 11 (L3-05 §1): pure-JS proctoring grouping.
    const proctoringSummary = proctoringSummarizer.summarizeProctoring(data.proctoringEvents);

    // Step 12-13 (L3-05 §2/§3).
    const preparationNotes = await preparationNotesGenerator.generatePreparationNotes(weaknesses);
    const recommendation = recommendationEngine.computeRecommendation(overallScore);

    // Step 14 (L3-05 §4/§5): final assembly, in the exact 19-section order.
    const report = await reportAssembler.assembleReport({
      session: data.session,
      candidate: data.candidate,
      questionEvaluations: questionEvaluationsWithBetterAnswers,
      skillResults,
      softSkills,
      languageProfile,
      codingSubmissions: data.codingSubmissions,
      categoryScores,
      overallScore,
      strengths,
      weaknesses,
      evidenceTrace,
      flatTranscript,
      proctoringSummary,
      preparationNotes,
      recommendation,
    });

    await reportRepository.markCompleted(sessionId, report, recommendation);
    logger.info(`report generation completed sessionId=${sessionId}`);
    return report;
  } catch (err) {
    logger.error(`report generation failed sessionId=${sessionId}:`, err.message);
    await reportRepository.markFailed(sessionId, err.message);
    throw err;
  }
}

module.exports = { generateReport };
