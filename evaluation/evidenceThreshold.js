// docFiles/L3-02 §2.2 "Evidence rule": "Only skills with sufficient interview
// evidence should receive strong conclusions... label it explicitly as
// moderate/limited evidence rather than guessing." Enforced HERE in code,
// not left to the prompt instruction alone — the model can't be trusted to
// reliably self-limit a confident-sounding rating, so this is a hard
// post-processing rule applied to every soft-skill dimension regardless of
// what the LLM returned.
const MIN_EVIDENCE_COUNT = 2;

function applyEvidenceThreshold(dimensionResult) {
  const evidenceCount = Number(dimensionResult?.evidenceCount) || 0;
  if (evidenceCount >= MIN_EVIDENCE_COUNT) return dimensionResult;

  const rating = dimensionResult?.rating || "Unknown";
  return {
    ...dimensionResult,
    rating: /limited evidence/i.test(rating) ? rating : `${rating} (limited evidence)`,
  };
}

module.exports = { applyEvidenceThreshold, MIN_EVIDENCE_COUNT };
