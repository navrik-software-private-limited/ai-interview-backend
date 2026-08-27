jest.mock("../../../config/database", () => ({
  getPool: jest.fn(),
  connectDatabase: jest.fn(),
  closeDatabase: jest.fn(),
  sql: require("../../helpers/mockDb").sqlTypesStub,
}));

const { getPool } = require("../../../config/database");
const { createMockPool } = require("../../helpers/mockDb");
const evaluationRepository = require("../../../evaluation/evaluationRepository");

describe("evaluation/evaluationRepository.upsertEvaluation", () => {
  let pool;

  beforeEach(() => {
    jest.clearAllMocks();
    pool = createMockPool();
    getPool.mockResolvedValue(pool);
  });

  test("serializes caseStudy into the case_study JSON input", async () => {
    const caseStudy = { understanding: { rating: "Strong", evidenceCount: 3, evidence: [] } };

    await evaluationRepository.upsertEvaluation("s1", { overallScore: 80, caseStudy });

    expect(pool._request.input).toHaveBeenCalledWith("caseStudy", expect.anything(), JSON.stringify(caseStudy));
  });

  test("defaults caseStudy to an empty object when omitted", async () => {
    await evaluationRepository.upsertEvaluation("s1", { overallScore: 80 });
    expect(pool._request.input).toHaveBeenCalledWith("caseStudy", expect.anything(), "{}");
  });

  test("doc/07 gap #6: serializes strengthsWithRefs/weaknessesWithRefs into their JSON inputs", async () => {
    const strengthsWithRefs = [{ text: "Strong communicator", questionRef: "q1" }];
    const weaknessesWithRefs = [{ text: "Weak on trade-offs", questionRef: "q2" }];

    await evaluationRepository.upsertEvaluation("s1", { overallScore: 80, strengthsWithRefs, weaknessesWithRefs });

    expect(pool._request.input).toHaveBeenCalledWith("strengthsWithRefs", expect.anything(), JSON.stringify(strengthsWithRefs));
    expect(pool._request.input).toHaveBeenCalledWith("weaknessesWithRefs", expect.anything(), JSON.stringify(weaknessesWithRefs));
  });

  test("defaults strengthsWithRefs/weaknessesWithRefs to an empty array when omitted", async () => {
    await evaluationRepository.upsertEvaluation("s1", { overallScore: 80 });
    expect(pool._request.input).toHaveBeenCalledWith("strengthsWithRefs", expect.anything(), "[]");
    expect(pool._request.input).toHaveBeenCalledWith("weaknessesWithRefs", expect.anything(), "[]");
  });

  test("still serializes every other existing field (no regression)", async () => {
    await evaluationRepository.upsertEvaluation("s1", {
      overallScore: 72,
      categoryScores: { technical: 80 },
      strengths: ["Strong communicator"],
    });

    expect(pool._request.input).toHaveBeenCalledWith("overallScore", expect.anything(), 72);
    expect(pool._request.input).toHaveBeenCalledWith("categoryScores", expect.anything(), JSON.stringify({ technical: 80 }));
    expect(pool._request.input).toHaveBeenCalledWith("strengths", expect.anything(), JSON.stringify(["Strong communicator"]));
  });
});
