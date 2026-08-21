const llmClient = require("../interviewer/llmClient");
const adminConfigRepository = require("../admin/adminConfigRepository");

// docFiles/L3-01 §2. "The exact scoring model should be configurable per
// interview type — do not hardcode weights." Weights are read from
// dbo.interview_configurations.configuration.evaluation_criteria.weights (an
// additive optional field on the existing JSON column — no schema change,
// it's already NVARCHAR(MAX)); falls back to equal weighting across whatever
// category scores are actually non-null if absent, same "never breaks on
// missing config" pattern already established for section order/targets in
// question-engine/sectionPlan.js.
const CATEGORIES = [
  "technical",
  "problem_solving",
  "case_analysis",
  "communication",
  "soft_skills",
  "theoretical",
  "language_profile",
  "coding",
];

const RATING_TO_NUMBER = {
  strong: 92,
  good: 78,
  moderate: 60,
  "moderate evidence": 60,
  weak: 38,
  "needs improvement": 45,
  "insufficient data": null,
  "limited evidence": null,
};

function ratingToNumber(rating) {
  if (typeof rating !== "string") return null;
  const key = rating.replace(/\s*\(limited evidence\)\s*$/i, "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(RATING_TO_NUMBER, key) ? RATING_TO_NUMBER[key] : null;
}

function averageSectionScore(questionEvaluations, sections) {
  const scores = questionEvaluations
    .filter((q) => sections.includes(q.section) && typeof q.score === "number")
    .map((q) => q.score * 10); // 0-10 -> 0-100
  if (!scores.length) return null;
  return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
}

function averageOf(values) {
  const usable = values.filter((v) => typeof v === "number");
  if (!usable.length) return null;
  return Math.round(usable.reduce((sum, v) => sum + v, 0) / usable.length);
}

// Coding submissions are LLM-judged (coding/codeEvaluator.js), not
// sandbox-executed — their evaluation is descriptive text, not a numeric
// score. This derives one aggregate 0-100 score FROM that already-produced
// text (not a re-judgment of the code itself) purely so coding can be folded
// into overall_score alongside every other category.
const CODING_SCORE_PROMPT = (submissions) => `
You are converting existing code-review notes into a single overall score for
a report. Do not re-review the code — only summarize the assessments below
into one number.

${submissions
  .map(
    (s, i) => `Submission ${i + 1}: correctness: "${s.evaluation?.correctness_assessment || "n/a"}"; approach: "${s.evaluation?.approach_quality || "n/a"}"; edge cases: "${s.evaluation?.edge_case_handling || "n/a"}"; code quality: "${s.evaluation?.code_quality || "n/a"}"`
  )
  .join("\n")}

Respond with strict JSON only: { "codingScore": number } where codingScore is 0-100.
`.trim();

async function estimateCodingScore(codingSubmissions) {
  const withEvaluation = codingSubmissions.filter((s) => s.evaluation);
  if (!withEvaluation.length) return null;
  const result = await llmClient.generateJson(CODING_SCORE_PROMPT(withEvaluation));
  return typeof result?.codingScore === "number" ? Math.max(0, Math.min(100, result.codingScore)) : null;
}

async function computeCategoryScores({ questionEvaluations, softSkills, languageProfile, codingSubmissions }) {
  const technical = averageSectionScore(questionEvaluations, ["JD_RESUME", "APTITUDE"]);
  return {
    technical,
    // Documented simplification (see plan): this schema has no separate
    // "theoretical" question category — every JD_RESUME/APTITUDE question
    // already asks the model to weigh conceptual correctness too
    // (evaluation/questionEvaluator.js), so theoretical reuses the same pool
    // rather than running a second, redundant LLM pass per question.
    theoretical: technical,
    case_analysis: averageSectionScore(questionEvaluations, ["CASE"]),
    problem_solving: ratingToNumber(softSkills?.problemSolving?.rating),
    communication: ratingToNumber(softSkills?.communication?.rating),
    soft_skills: averageOf(Object.values(softSkills || {}).map((d) => ratingToNumber(d?.rating))),
    language_profile: averageOf(Object.values(languageProfile || {}).map(ratingToNumber)),
    coding: await estimateCodingScore(codingSubmissions),
  };
}

async function resolveWeights() {
  const active = await adminConfigRepository.getActiveConfiguration();
  const configured = active?.configuration?.evaluation_criteria?.weights;
  if (configured && typeof configured === "object") return configured;
  return CATEGORIES.reduce((acc, c) => ({ ...acc, [c]: 1 }), {});
}

function computeOverallScore(categoryScores, weights) {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const category of CATEGORIES) {
    const score = categoryScores[category];
    if (typeof score !== "number") continue;
    const weight = typeof weights[category] === "number" ? weights[category] : 1;
    weightedSum += score * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return null;
  return Math.round((weightedSum / totalWeight) * 100) / 100;
}

async function aggregateScores(input) {
  const categoryScores = await computeCategoryScores(input);
  const weights = await resolveWeights();
  const overallScore = computeOverallScore(categoryScores, weights);
  return { categoryScores, overallScore };
}

module.exports = { aggregateScores, ratingToNumber, CATEGORIES };
