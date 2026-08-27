const { traceEvidence } = require("../../../evaluation/evidenceTracer");

describe("evaluation/evidenceTracer", () => {
  test("groups questionAskedId values by their mapped category", () => {
    const trace = traceEvidence([
      { section: "JD_RESUME", questionAskedId: "q1" },
      { section: "JD_RESUME", questionAskedId: "q2" },
      { section: "APTITUDE", questionAskedId: "q3" },
      { section: "CASE", questionAskedId: "q4" },
      { section: "MINDSET", questionAskedId: "q5" },
    ]);

    expect(trace).toEqual({
      technical: ["q1", "q2"],
      problem_solving: ["q3"],
      case_analysis: ["q4"],
      soft_skills: ["q5"],
    });
  });

  test("falls back to the raw section name as the category when unmapped", () => {
    const trace = traceEvidence([{ section: "CODING", questionAskedId: "q1" }]);
    expect(trace).toEqual({ CODING: ["q1"] });
  });

  test("returns an empty object for no evaluations", () => {
    expect(traceEvidence([])).toEqual({});
  });
});
