jest.mock("../../../reporting/reportRepository");
const reportRepository = require("../../../reporting/reportRepository");
const { getReport, getReportInternal } = require("../../../reporting/reportController");

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe("reporting/reportController.getReport", () => {
  beforeEach(() => jest.clearAllMocks());

  test("404s when no report row exists for the session", async () => {
    reportRepository.fetchReport.mockResolvedValue(null);
    const req = { params: { sessionId: "s1" } };
    const res = mockRes();

    await getReport(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: "report_not_found" });
  });

  test("409s (report_not_ready) when the report exists but isn't COMPLETED yet", async () => {
    reportRepository.fetchReport.mockResolvedValue({ status: "GENERATING", report: null });
    const req = { params: { sessionId: "s1" } };
    const res = mockRes();

    await getReport(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: "report_not_ready", status: "GENERATING" })
    );
  });

  test("returns 200 with the report payload once COMPLETED", async () => {
    reportRepository.fetchReport.mockResolvedValue({ status: "COMPLETED", report: { overall_score: 91 } });
    const req = { params: { sessionId: "s1" } };
    const res = mockRes();

    await getReport(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, sessionId: "s1", report: { overall_score: 91 } });
  });

  test("a FAILED report status also returns 409, not the failed payload", async () => {
    reportRepository.fetchReport.mockResolvedValue({ status: "FAILED", report: null });
    const req = { params: { sessionId: "s1" } };
    const res = mockRes();

    await getReport(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });
});

// doc/07 gap #8: internal sibling of getReport, used by practywiz-backend's
// service-to-service proxy (verifyInternalServiceKey, not the session-scoped
// interview-access token) — same resolution logic, so mirror the same cases.
describe("reporting/reportController.getReportInternal", () => {
  beforeEach(() => jest.clearAllMocks());

  test("404s when no report row exists for the session", async () => {
    reportRepository.fetchReport.mockResolvedValue(null);
    const req = { params: { sessionId: "s1" } };
    const res = mockRes();

    await getReportInternal(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: "report_not_found" });
  });

  test("409s (report_not_ready) when the report exists but isn't COMPLETED yet", async () => {
    reportRepository.fetchReport.mockResolvedValue({ status: "GENERATING", report: null });
    const req = { params: { sessionId: "s1" } };
    const res = mockRes();

    await getReportInternal(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: "report_not_ready", status: "GENERATING" })
    );
  });

  test("returns 200 with the report payload once COMPLETED", async () => {
    reportRepository.fetchReport.mockResolvedValue({ status: "COMPLETED", report: { overall_score: 91 } });
    const req = { params: { sessionId: "s1" } };
    const res = mockRes();

    await getReportInternal(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, sessionId: "s1", report: { overall_score: 91 } });
  });
});
