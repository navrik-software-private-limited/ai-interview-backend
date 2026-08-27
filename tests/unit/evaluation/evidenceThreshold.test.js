const { applyEvidenceThreshold, MIN_EVIDENCE_COUNT } = require("../../../evaluation/evidenceThreshold");

describe("evaluation/evidenceThreshold", () => {
  test("MIN_EVIDENCE_COUNT is 2 (docFiles/L3-02 §2.2 evidence rule)", () => {
    expect(MIN_EVIDENCE_COUNT).toBe(2);
  });

  test("leaves a dimension result unchanged when evidenceCount meets the threshold", () => {
    const input = { rating: "Strong", evidenceCount: 2 };
    expect(applyEvidenceThreshold(input)).toEqual(input);
  });

  test("leaves a dimension result unchanged when evidenceCount exceeds the threshold", () => {
    const input = { rating: "Strong", evidenceCount: 5 };
    expect(applyEvidenceThreshold(input)).toEqual(input);
  });

  test("appends '(limited evidence)' when evidenceCount is below the threshold", () => {
    const result = applyEvidenceThreshold({ rating: "Strong", evidenceCount: 1 });
    expect(result.rating).toBe("Strong (limited evidence)");
  });

  test("treats a missing evidenceCount as 0", () => {
    const result = applyEvidenceThreshold({ rating: "Good" });
    expect(result.rating).toBe("Good (limited evidence)");
  });

  test("defaults rating to 'Unknown' when missing", () => {
    const result = applyEvidenceThreshold({ evidenceCount: 0 });
    expect(result.rating).toBe("Unknown (limited evidence)");
  });

  test("does not double-suffix a rating that already says limited evidence", () => {
    const result = applyEvidenceThreshold({ rating: "Weak (limited evidence)", evidenceCount: 0 });
    expect(result.rating).toBe("Weak (limited evidence)");
  });

  test("preserves other fields on the dimension result", () => {
    const result = applyEvidenceThreshold({ rating: "Good", evidenceCount: 0, notes: "kept" });
    expect(result.notes).toBe("kept");
  });

  test("handles a null/undefined input without throwing", () => {
    const result = applyEvidenceThreshold(null);
    expect(result.rating).toBe("Unknown (limited evidence)");
  });
});
