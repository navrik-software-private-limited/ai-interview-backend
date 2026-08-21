// docFiles/L3-03 §1: rolls per-question scores up into a per-skill
// strong|good|moderate|weak bucket. Pure JS, no LLM — the LLM already
// produced the per-question score in questionEvaluator.js; this is just
// arithmetic on top of it.
//
// There's no per-question skill tag in this schema (only `section`), and
// evaluation/sessionDataLoader.js's `skillLabels` (from
// jd-resume/contextBuilder.js's contextSnapshot.skills) isn't guaranteed to
// exist or to map cleanly onto individual questions. Rather than fabricate a
// skill->question mapping that doesn't really exist, this rolls up per
// SECTION (JD_RESUME/APTITUDE/CASE/MINDSET — the one grouping every question
// really does carry) and additionally exposes the raw skill label list
// alongside the overall average, so callers that do have skill labels can
// still surface them without this module inventing a false-precision link.

const THRESHOLDS = [
  { min: 8.5, result: "strong" },
  { min: 7, result: "good" },
  { min: 5, result: "moderate" },
];

function bucketFor(averageScore) {
  if (averageScore === null || Number.isNaN(averageScore)) return "moderate";
  const match = THRESHOLDS.find((t) => averageScore >= t.min);
  return match ? match.result : "weak";
}

// questionEvaluations: the array returned by questionEvaluator.evaluateAllQuestions.
function aggregateSkillResults(questionEvaluations, skillLabels = []) {
  const bySection = new Map();
  for (const evaluation of questionEvaluations) {
    if (evaluation.score === null || evaluation.score === undefined) continue;
    if (!bySection.has(evaluation.section)) bySection.set(evaluation.section, []);
    bySection.get(evaluation.section).push(evaluation.score);
  }

  const skillResults = {};
  for (const [section, scores] of bySection.entries()) {
    const average = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    skillResults[section] = bucketFor(average);
  }

  return {
    bySection: skillResults,
    // Best-effort: if the JD/resume analysis produced named skills, surface
    // them for the report's technical-skills section without claiming a
    // per-skill score we don't actually have evidence for.
    skillLabels,
  };
}

module.exports = { aggregateSkillResults };
