const llmClient = require("../interviewer/llmClient");

// docFiles/L3-05 §4: the exact 19-section order. Acceptance criterion: "no
// section silently omitted — empty sections should say insufficient data,
// not disappear." `orInsufficientData` enforces that uniformly below rather
// than leaving each section to remember it individually.
function orInsufficientData(value) {
  if (value === null || value === undefined) return "Insufficient data";
  if (Array.isArray(value) && value.length === 0) return "Insufficient data";
  if (typeof value === "object" && Object.keys(value).length === 0) return "Insufficient data";
  return value;
}

const EXECUTIVE_SUMMARY_PROMPT = ({ overallScore, strengths, weaknesses, recommendation }) => `
Write a short (3-5 sentence) executive summary of a candidate's mock
interview performance, for their own preparation. Be honest and specific, not
generic praise.

Overall score: ${overallScore ?? "not available"}/100
Strengths: ${strengths.join("; ") || "none identified"}
Weaknesses: ${weaknesses.join("; ") || "none identified"}
Recommendation: ${recommendation}

Respond with strict JSON only, no other text: { "executiveSummary": string }
`.trim();

async function generateExecutiveSummary({ overallScore, strengths, weaknesses, recommendation }) {
  const result = await llmClient.generateJson(
    EXECUTIVE_SUMMARY_PROMPT({ overallScore, strengths, weaknesses, recommendation })
  );
  return (
    result?.executiveSummary ||
    `Overall score: ${overallScore ?? "not available"}/100. Recommendation: ${recommendation}.`
  );
}

function questionsForSection(questionEvaluations, sections) {
  return questionEvaluations.filter((q) => sections.includes(q.section));
}

// Assembles the final Report entity (Module 01 §3.16) in the exact section
// order from L3-05 §4. All inputs are already-computed outputs from the
// other evaluation/ modules — this module's only real job is the
// executive-summary LLM call plus faithful assembly/ordering.
async function assembleReport({
  session,
  candidate,
  questionEvaluations,
  skillResults,
  softSkills,
  languageProfile,
  codingSubmissions,
  categoryScores,
  overallScore,
  strengths,
  weaknesses,
  evidenceTrace,
  flatTranscript,
  proctoringSummary,
  preparationNotes,
  recommendation,
}) {
  const executiveSummary = await generateExecutiveSummary({
    overallScore,
    strengths,
    weaknesses,
    recommendation,
  });

  const betterAnswerSuggestions = questionEvaluations
    .filter((q) => q.betterAnswer)
    .map((q) => ({
      questionAskedId: q.questionAskedId,
      section: q.section,
      questionText: q.questionText,
      candidateAnswer: q.answerText,
      betterAnswer: q.betterAnswer,
    }));

  const questionByQuestionAnalysis = questionEvaluations.map((q) => ({
    questionAskedId: q.questionAskedId,
    section: q.section,
    question: q.questionText,
    candidateAnswer: q.answerText,
    score: q.score,
    whatWasGood: q.whatWasGood,
    whatCouldImprove: q.whatCouldImprove,
    understandingLevel: q.understandingLevel,
    improvementSuggestion: q.improvementSuggestion,
  }));

  return {
    // 1. Candidate Information
    candidate_information: orInsufficientData(candidate),
    // 2. Interview Information
    interview_information: {
      sessionId: session.id,
      interviewId: session.interviewId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      completionReason: session.completionReason,
    },
    // 3. Overall Score
    overall_score: overallScore,
    // 4. Executive Summary
    executive_summary: executiveSummary,
    // 5. Strengths
    strengths: orInsufficientData(strengths),
    // 6. Weaknesses
    weaknesses: orInsufficientData(weaknesses),
    // 7. Technical Skills Evaluation
    technical_skills_evaluation: orInsufficientData({
      categoryScore: categoryScores.technical,
      bySection: skillResults.bySection,
      skillLabels: skillResults.skillLabels,
      questions: questionsForSection(questionEvaluations, ["JD_RESUME"]),
    }),
    // 8. Aptitude Evaluation
    aptitude_evaluation: orInsufficientData({
      categoryScore: categoryScores.problem_solving,
      questions: questionsForSection(questionEvaluations, ["APTITUDE"]),
    }),
    // 9. Case Study Evaluation
    case_study_evaluation: orInsufficientData({
      categoryScore: categoryScores.case_analysis,
      questions: questionsForSection(questionEvaluations, ["CASE"]),
    }),
    // 10. Coding Evaluation
    coding_evaluation: orInsufficientData({
      categoryScore: categoryScores.coding,
      submissions: codingSubmissions.map((s) => ({
        sequence: s.sequence,
        language: s.language,
        problemStatement: s.problemStatement,
        evaluation: s.evaluation,
      })),
    }),
    // 11. Theoretical Knowledge — documented simplification: this schema has
    // no separate theoretical question category, so this reuses the same
    // JD_RESUME/APTITUDE question evaluations as Technical (see
    // scoringAggregator.js's `theoretical: technical` for the same reasoning).
    theoretical_knowledge: orInsufficientData(questionsForSection(questionEvaluations, ["JD_RESUME", "APTITUDE"])),
    // 12. Soft Skills
    soft_skills: orInsufficientData(softSkills),
    // 13. Language Profile
    language_profile: orInsufficientData(languageProfile),
    // 14. Question-by-Question Analysis
    question_by_question_analysis: orInsufficientData(questionByQuestionAnalysis),
    // 15. Candidate Transcripts
    transcript: orInsufficientData(flatTranscript),
    // 16. Better Answer Suggestions
    better_answer_suggestions: orInsufficientData(betterAnswerSuggestions),
    // 17. Proctoring Summary
    proctoring_summary: orInsufficientData(proctoringSummary),
    // 18. Additional Preparation Notes
    preparation_notes: orInsufficientData(preparationNotes.map((n) => n.recommendation)),
    // 19. Final Recommendation
    final_recommendation: recommendation,
    evidence_trace: evidenceTrace,
    generated_at: new Date().toISOString(),
  };
}

module.exports = { assembleReport };
