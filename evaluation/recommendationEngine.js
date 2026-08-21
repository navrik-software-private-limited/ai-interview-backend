// docFiles/L3-05 §3 + AI-01 §2's own guidance: "prefer rule-based + evidence,
// AI only for phrasing" — no LLM call here, a plain score-threshold table.
//
// This product is candidate-facing mock-interview prep throughout (root
// CLAUDE.md's candidate flow: login -> profile -> dashboard -> case
// selection -> interview -> report), never an employer/recruiter ATS tool —
// so this uses the generic spec's "candidate self-preparation mode" labels
// (READY/NEEDS_IMPROVEMENT/SIGNIFICANT_PREPARATION_REQUIRED), not the
// recruitment hire/no-hire labels. Thresholds are a simple table, easy to
// retune later.
const THRESHOLDS = [
  { min: 80, recommendation: "READY" },
  { min: 60, recommendation: "NEEDS_IMPROVEMENT" },
];

function computeRecommendation(overallScore) {
  if (typeof overallScore !== "number") return "SIGNIFICANT_PREPARATION_REQUIRED";
  const match = THRESHOLDS.find((t) => overallScore >= t.min);
  return match ? match.recommendation : "SIGNIFICANT_PREPARATION_REQUIRED";
}

module.exports = { computeRecommendation };
