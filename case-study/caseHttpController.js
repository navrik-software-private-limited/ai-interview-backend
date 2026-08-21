const sessionRepository = require("../session/sessionRepository");

// 03-LIVE-INTERVIEW-MODULE.md §8: GET /api/sessions/:sessionId/case — exists
// for the reconnect/refresh case (case.presented was already delivered live
// over the socket; this lets a refreshed tab re-fetch the same content).
async function getCase(req, res) {
  const { sessionId } = req.params;
  const context = await sessionRepository.fetchSessionContext(sessionId);
  const caseContentText = context && context.contextSnapshot && context.contextSnapshot.caseContentText;
  return res.status(200).json({ success: true, sessionId, content: caseContentText || null });
}

module.exports = { getCase };
