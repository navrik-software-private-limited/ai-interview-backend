jest.mock("../../../config/database", () => ({
  getPool: jest.fn(),
  connectDatabase: jest.fn(),
  closeDatabase: jest.fn(),
  sql: require("../../helpers/mockDb").sqlTypesStub,
}));

const { getPool } = require("../../../config/database");
const { createMockPool } = require("../../helpers/mockDb");
const { fetchCandidateName } = require("../../../session/candidateRepository");

describe("session/candidateRepository.fetchCandidateName", () => {
  let pool;

  beforeEach(() => {
    jest.clearAllMocks();
    pool = createMockPool();
    getPool.mockResolvedValue(pool);
  });

  test("doc/07 gap #9: returns the candidate's name when a row exists", async () => {
    pool._request.query.mockResolvedValueOnce({ recordset: [{ name: "Priya" }] });

    const result = await fetchCandidateName(42);

    expect(pool._request.input).toHaveBeenCalledWith("candidateId", expect.anything(), 42);
    expect(result).toBe("Priya");
  });

  test("returns null when no candidate row is found", async () => {
    pool._request.query.mockResolvedValueOnce({ recordset: [] });
    const result = await fetchCandidateName(42);
    expect(result).toBeNull();
  });

  test("returns null without querying when candidateId is falsy", async () => {
    const result = await fetchCandidateName(null);
    expect(result).toBeNull();
    expect(getPool).not.toHaveBeenCalled();
  });

  test("returns null (never throws) if the query fails", async () => {
    pool._request.query.mockRejectedValueOnce(new Error("db down"));
    const result = await fetchCandidateName(42);
    expect(result).toBeNull();
  });
});
