const reportRepository = require("./reportRepository");

// GET /api/sessions/:sessionId/report — the full assembled Report (Module 01
// §3.16), once generation has actually completed. Distinct from
// reportStatusController.js's lightweight status-only endpoint (used for
// polling); this one returns the real payload the candidate's report page
// renders.
async function getReport(req, res) {
  const { sessionId } = req.params;
  const report = await reportRepository.fetchReport(sessionId);

  if (!report) {
    return res.status(404).json({ success: false, error: "report_not_found" });
  }
  if (report.status !== "COMPLETED") {
    return res.status(409).json({ success: false, error: "report_not_ready", status: report.status });
  }

  return res.status(200).json({ success: true, sessionId, report: report.report });
}

module.exports = { getReport };
