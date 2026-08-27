jest.mock("../../../config/database", () => ({
  getPool: jest.fn(),
  connectDatabase: jest.fn(),
  closeDatabase: jest.fn(),
  sql: require("../../helpers/mockDb").sqlTypesStub,
}));

const { getPool } = require("../../../config/database");
const { createMockPool } = require("../../helpers/mockDb");
const reportRepository = require("../../../reporting/reportRepository");

describe("reporting/reportRepository", () => {
  let pool;

  beforeEach(() => {
    jest.clearAllMocks();
    pool = createMockPool();
    getPool.mockResolvedValue(pool);
  });

  test("fetchReport returns null when no row exists", async () => {
    pool._request.query.mockResolvedValueOnce({ recordset: [] });
    const result = await reportRepository.fetchReport("s1");
    expect(result).toBeNull();
  });

  test("fetchReport parses the stored report JSON", async () => {
    pool._request.query.mockResolvedValueOnce({
      recordset: [
        {
          id: "r1",
          sessionId: "s1",
          status: "COMPLETED",
          report: JSON.stringify({ overall_score: 88 }),
          finalRecommendation: "READY",
          errorMessage: null,
          generatedAt: "2026-01-01T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const result = await reportRepository.fetchReport("s1");

    expect(result.status).toBe("COMPLETED");
    expect(result.report).toEqual({ overall_score: 88 });
    expect(result.finalRecommendation).toBe("READY");
  });

  test("fetchReport returns a null report field when the column itself is null (e.g. still GENERATING)", async () => {
    pool._request.query.mockResolvedValueOnce({
      recordset: [{ id: "r1", sessionId: "s1", status: "GENERATING", report: null }],
    });
    const result = await reportRepository.fetchReport("s1");
    expect(result.report).toBeNull();
  });

  test("markGenerating writes the sessionId parameter", async () => {
    await reportRepository.markGenerating("s1");
    expect(pool._request.input).toHaveBeenCalledWith("sessionId", expect.anything(), "s1");
    expect(pool._request.query).toHaveBeenCalledTimes(1);
  });

  test("markCompleted stringifies the report and passes the recommendation", async () => {
    await reportRepository.markCompleted("s1", { overall_score: 90 }, "READY");
    expect(pool._request.input).toHaveBeenCalledWith("report", expect.anything(), JSON.stringify({ overall_score: 90 }));
    expect(pool._request.input).toHaveBeenCalledWith("finalRecommendation", expect.anything(), "READY");
  });

  test("markFailed truncates an overly long error message to 500 characters", async () => {
    const longMessage = "x".repeat(1000);
    await reportRepository.markFailed("s1", longMessage);
    const call = pool._request.input.mock.calls.find(([name]) => name === "errorMessage");
    expect(call[2]).toHaveLength(500);
  });

  test("markFailed stringifies a non-Error value passed as the message", async () => {
    await reportRepository.markFailed("s1", { some: "object" });
    const call = pool._request.input.mock.calls.find(([name]) => name === "errorMessage");
    expect(typeof call[2]).toBe("string");
  });
});
