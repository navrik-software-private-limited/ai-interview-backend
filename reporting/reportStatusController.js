const reportRepository = require("./reportRepository");

// GET /api/sessions/:sessionId/report/status. Phase 4 (Layer 3): now reads
// the real dbo.interview_reports row instead of hardcoding PENDING —
// evaluationPipeline.js writes GENERATING/COMPLETED/FAILED to this same row.
// PENDING now means specifically "no row exists yet" (the interview hasn't
// finished, so report generation hasn't been triggered) — distinct from
// GENERATING, which means the pipeline is actively running.
async function getReportStatus(req, res) {
  const { sessionId } = req.params;
  const report = await reportRepository.fetchReport(sessionId);

  if (!report) {
    return res.status(200).json({ success: true, sessionId, status: "PENDING" });
  }

  return res.status(200).json({
    success: true,
    sessionId,
    status: report.status,
    ...(report.status === "FAILED" ? { message: report.errorMessage } : {}),
  });
}

module.exports = { getReportStatus };
