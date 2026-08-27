jest.mock("../../../reporting/reportRepository");
const reportRepository = require("../../../reporting/reportRepository");
const { getReportStatus } = require("../../../reporting/reportStatusController");

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe("reporting/reportStatusController.getReportStatus", () => {
  beforeEach(() => jest.clearAllMocks());

  test("PENDING means no row exists yet (interview not finished / generation not triggered)", async () => {
    reportRepository.fetchReport.mockResolvedValue(null);
    const req = { params: { sessionId: "s1" } };
    const res = mockRes();

    await getReportStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, sessionId: "s1", status: "PENDING" });
  });

  test("reports GENERATING while the pipeline is actively running", async () => {
    reportRepository.fetchReport.mockResolvedValue({ status: "GENERATING" });
    const res = mockRes();

    await getReportStatus({ params: { sessionId: "s1" } }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: "GENERATING" }));
  });

  test("includes the error message only when status is FAILED", async () => {
    reportRepository.fetchReport.mockResolvedValue({ status: "FAILED", errorMessage: "boom" });
    const res = mockRes();

    await getReportStatus({ params: { sessionId: "s1" } }, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED", message: "boom" })
    );
  });

  test("does not include a message field for a COMPLETED status", async () => {
    reportRepository.fetchReport.mockResolvedValue({ status: "COMPLETED" });
    const res = mockRes();

    await getReportStatus({ params: { sessionId: "s1" } }, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload).not.toHaveProperty("message");
  });
});
