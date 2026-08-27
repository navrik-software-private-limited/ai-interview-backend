const reportRepository = require("./reportRepository");

// Shared by both handlers below — same 404/409/200 resolution either way,
// only the auth middleware in front differs (see reportRoutes.js vs.
// internalReportRoutes.js).
async function resolveReport(sessionId) {
  const report = await reportRepository.fetchReport(sessionId);

  if (!report) {
    return { statusCode: 404, body: { success: false, error: "report_not_found" } };
  }
  if (report.status !== "COMPLETED") {
    return { statusCode: 409, body: { success: false, error: "report_not_ready", status: report.status } };
  }
  return { statusCode: 200, body: { success: true, sessionId, report: report.report } };
}

// GET /api/sessions/:sessionId/report — the full assembled Report (Module 01
// §3.16), once generation has actually completed. Distinct from
// reportStatusController.js's lightweight status-only endpoint (used for
// polling); this one returns the real payload the candidate's report page
// renders. Guarded by the session-scoped interview-access token
// (reportRoutes.js) — only usable while that token is still valid.
async function getReport(req, res) {
  const { sessionId } = req.params;
  const { statusCode, body } = await resolveReport(sessionId);
  return res.status(statusCode).json(body);
}

// doc/07_INTERVIEW_MODULE_STATUS_AND_ROADMAP.md gap #8: internal
// (verifyInternalServiceKey-guarded, see internalReportRoutes.js) sibling of
// getReport above, for practywiz-backend to fetch a candidate's own full
// report outside the live session — by the time a candidate revisits the
// Reports tab, their short-lived interview-access token is long gone, so
// practywiz-backend calls this service-to-service instead (same trust model
// as session/candidateSessionsController.js).
async function getReportInternal(req, res) {
  const { sessionId } = req.params;
  const { statusCode, body } = await resolveReport(sessionId);
  return res.status(statusCode).json(body);
}

module.exports = { getReport, getReportInternal };
