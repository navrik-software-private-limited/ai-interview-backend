// docFiles/L3-01 §5 / Module 01 §4 (mandatory auditability rule): "Every
// score must trace to evidence... store this trace alongside the score — it
// is required output, not optional metadata." Pure JS grouping, no LLM —
// the evidence is just which questions fed which category, already known
// from each question evaluation's `section`.
const SECTION_TO_CATEGORY = {
  JD_RESUME: "technical",
  APTITUDE: "problem_solving",
  CASE: "case_analysis",
  MINDSET: "soft_skills",
};

// questionEvaluations: questionEvaluator.evaluateAllQuestions output.
function traceEvidence(questionEvaluations) {
  const trace = {};
  for (const evaluation of questionEvaluations) {
    const category = SECTION_TO_CATEGORY[evaluation.section] || evaluation.section;
    if (!trace[category]) trace[category] = [];
    trace[category].push(evaluation.questionAskedId);
  }
  return trace;
}

module.exports = { traceEvidence };
