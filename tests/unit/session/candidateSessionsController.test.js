jest.mock("../../../session/sessionRepository");
const sessionRepository = require("../../../session/sessionRepository");
const { listSessionsForCandidate } = require("../../../session/candidateSessionsController");

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe("session/candidateSessionsController.listSessionsForCandidate", () => {
  beforeEach(() => jest.clearAllMocks());

  test("400s when candidateId is missing", async () => {
    const req = { params: {}, query: {} };
    const res = mockRes();

    await listSessionsForCandidate(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(sessionRepository.fetchSessionsForCandidate).not.toHaveBeenCalled();
  });

  test("doc/07 gap #8: defaults to page 1 / limit 10 when no query params are given", async () => {
    sessionRepository.fetchSessionsForCandidate.mockResolvedValue({ sessions: [], total: 0 });
    const req = { params: { candidateId: "5" }, query: {} };
    const res = mockRes();

    await listSessionsForCandidate(req, res);

    expect(sessionRepository.fetchSessionsForCandidate).toHaveBeenCalledWith(5, { page: 1, limit: 10 });
    expect(res.json).toHaveBeenCalledWith({ success: true, sessions: [], total: 0, page: 1, limit: 10 });
  });

  test("passes through explicit page/limit query params", async () => {
    sessionRepository.fetchSessionsForCandidate.mockResolvedValue({ sessions: [{ sessionId: "s1" }], total: 23 });
    const req = { params: { candidateId: "5" }, query: { page: "3", limit: "5" } };
    const res = mockRes();

    await listSessionsForCandidate(req, res);

    expect(sessionRepository.fetchSessionsForCandidate).toHaveBeenCalledWith(5, { page: 3, limit: 5 });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      sessions: [{ sessionId: "s1" }],
      total: 23,
      page: 3,
      limit: 5,
    });
  });

  test("clamps limit to a maximum of 50 and page to a minimum of 1", async () => {
    sessionRepository.fetchSessionsForCandidate.mockResolvedValue({ sessions: [], total: 0 });
    const req = { params: { candidateId: "5" }, query: { page: "0", limit: "9999" } };
    const res = mockRes();

    await listSessionsForCandidate(req, res);

    expect(sessionRepository.fetchSessionsForCandidate).toHaveBeenCalledWith(5, { page: 1, limit: 50 });
  });

  test("500s and logs when the repository throws", async () => {
    sessionRepository.fetchSessionsForCandidate.mockRejectedValue(new Error("db down"));
    const req = { params: { candidateId: "5" }, query: {} };
    const res = mockRes();

    await listSessionsForCandidate(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: "Failed to load sessions" });
  });
});
