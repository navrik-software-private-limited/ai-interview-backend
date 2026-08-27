const llmClient = require("../interviewer/llmClient");
const { applyEvidenceThreshold } = require("./evidenceThreshold");

// doc/07_INTERVIEW_MODULE_STATUS_AND_ROADMAP.md gap #5 / doc 04 §7: the CASE
// section's own evaluation dimensions, distinct from the generic per-question
// rubric questionEvaluator.js applies to every section. Mirrors
// softSkillsEvaluator.js's shape (evidence-grounded ratings, evidenceThreshold
// enforcement) — same rating vocabulary, same "don't inflate evidenceCount"
// instruction.
const DIMENSIONS = ["understanding", "approach", "reasoning", "tradeoffs", "technicalBusinessThinking", "communication"];

const PROMPT_TEMPLATE = (caseQuestionEvaluations) => `
You are evaluating a candidate's performance on the case-study portion of a
mock interview, using ONLY evidence actually present below.

Case-study questions and answers:
${caseQuestionEvaluations
  .map((q, i) => `${i + 1}. "${q.questionText}" -> Answer: "${q.answerText || "(no answer captured)"}" | Notes: good: ${(q.whatWasGood || []).join("; ") || "none noted"}; improve: ${(q.whatCouldImprove || []).join("; ") || "none noted"}`)
  .join("\n")}

For each dimension below, respond with strict JSON only, no other text:
{
  "understanding": { "rating": string, "evidenceCount": number, "evidence": [{"note": string}] },
  "approach": { "rating": string, "evidenceCount": number, "evidence": [{"note": string}] },
  "reasoning": { "rating": string, "evidenceCount": number, "evidence": [{"note": string}] },
  "tradeoffs": { "rating": string, "evidenceCount": number, "evidence": [{"note": string}] },
  "technicalBusinessThinking": { "rating": string, "evidenceCount": number, "evidence": [{"note": string}] },
  "communication": { "rating": string, "evidenceCount": number, "evidence": [{"note": string}] }
}
"rating" must be one of "Strong", "Good", "Moderate evidence", or "Limited evidence".
Set "evidenceCount" honestly to how many distinct moments actually support this
dimension — do not inflate it to justify a confident rating.
`.trim();

// Per-dimension fallback when the LLM response is missing that field — same
// wording as softSkillsEvaluator.js's fallbackDimension(), so
// applyEvidenceThreshold's "already says limited evidence" check (which does
// a substring match) doesn't double-suffix it.
function fallbackDimension() {
  return { rating: "Limited evidence", evidenceCount: 0, evidence: [] };
}

// Whole-profile fallback when there's nothing to evaluate at all (CASE
// skipped) — never passed through applyEvidenceThreshold, so "Insufficient
// data" stays exactly that instead of becoming "Insufficient data (limited
// evidence)".
function insufficientDataProfile() {
  const profile = {};
  for (const dimension of DIMENSIONS) profile[dimension] = { rating: "Insufficient data", evidenceCount: 0, evidence: [] };
  return profile;
}

// questionEvaluations: questionEvaluator.evaluateAllQuestions output (any
// section) — this module filters to CASE itself, same as how
// scoringAggregator.js's averageSectionScore filters by section rather than
// requiring the caller to pre-filter.
async function evaluateCaseStudy(questionEvaluations) {
  const caseQuestionEvaluations = (questionEvaluations || []).filter((q) => q.section === "CASE");

  // Mirrors languageProfiler.js's MIN_WORD_COUNT guard: nothing to evaluate
  // honestly if the CASE section was skipped or never reached — return
  // "Insufficient data" rather than fabricating a rating from nothing.
  if (!caseQuestionEvaluations.length) {
    return insufficientDataProfile();
  }

  const result = await llmClient.generateJson(PROMPT_TEMPLATE(caseQuestionEvaluations));

  const output = {};
  for (const dimension of DIMENSIONS) {
    const raw = result?.[dimension] || fallbackDimension();
    output[dimension] = applyEvidenceThreshold(raw);
  }
  return output;
}

module.exports = { evaluateCaseStudy, DIMENSIONS };
