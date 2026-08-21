const proctoringEventRepository = require("./proctoringEventRepository");

// L2-05 §7: GET /api/proctoring/{session_id}/events
async function getProctoringEvents(req, res) {
  const { sessionId } = req.params;
  const events = await proctoringEventRepository.fetchProctoringEvents(sessionId);
  return res.status(200).json({ success: true, sessionId, events });
}

module.exports = { getProctoringEvents };
