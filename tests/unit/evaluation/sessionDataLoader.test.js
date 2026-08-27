jest.mock("../../../config/database", () => ({
  getPool: jest.fn(),
  connectDatabase: jest.fn(),
  closeDatabase: jest.fn(),
  sql: require("../../helpers/mockDb").sqlTypesStub,
}));
jest.mock("../../../session/sessionRepository");
jest.mock("../../../proctoring/proctoringEventRepository");

const { getPool } = require("../../../config/database");
const { createMockPool } = require("../../helpers/mockDb");
const sessionRepository = require("../../../session/sessionRepository");
const proctoringEventRepository = require("../../../proctoring/proctoringEventRepository");
const { loadSessionData } = require("../../../evaluation/sessionDataLoader");

// doc/07_INTERVIEW_MODULE_STATUS_AND_ROADMAP.md gap #11: verifies the guard
// that decides which sessions are even eligible for report generation —
// COMPLETED and (as of this fix) ABANDONED are both terminal, anything else
// (a still-live session) must be refused.
describe("evaluation/sessionDataLoader.loadSessionData", () => {
  let pool;

  beforeEach(() => {
    jest.clearAllMocks();
    pool = createMockPool();
    getPool.mockResolvedValue(pool);
    sessionRepository.fetchSessionContext.mockResolvedValue(null);
    proctoringEventRepository.fetchProctoringEvents.mockResolvedValue([]);
  });

  function mockSessionRow(status) {
    pool._request.query.mockResolvedValueOnce({
      recordset: [{ id: "s1", candidateId: 1, interviewId: "i1", status, startedAt: null, endedAt: null, completionReason: null }],
    });
    // Every subsequent query in the Promise.all (candidate/questions/transcripts/coding) — empty is fine.
    pool._request.query.mockResolvedValue({ recordset: [] });
  }

  test("throws when the session doesn't exist", async () => {
    pool._request.query.mockResolvedValueOnce({ recordset: [] });
    await expect(loadSessionData("missing")).rejects.toThrow("session not found");
  });

  test("throws for a still-live session status", async () => {
    mockSessionRow("ACTIVE");
    await expect(loadSessionData("s1")).rejects.toThrow(/not in a terminal state/);
  });

  test("succeeds for a COMPLETED session", async () => {
    mockSessionRow("COMPLETED");
    await expect(loadSessionData("s1")).resolves.toEqual(
      expect.objectContaining({ session: expect.objectContaining({ status: "COMPLETED" }) })
    );
  });

  test("doc/07 gap #11: succeeds for an ABANDONED session too", async () => {
    mockSessionRow("ABANDONED");
    await expect(loadSessionData("s1")).resolves.toEqual(
      expect.objectContaining({ session: expect.objectContaining({ status: "ABANDONED" }) })
    );
  });
});
