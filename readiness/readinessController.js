const readinessService = require("./readinessService");

async function reportCheck(req, res) {
  const { sessionId } = req.params;
  const { checkType, measurement } = req.body;

  if (!checkType) {
    return res.status(400).json({ success: false, error: "checkType is required" });
  }

  const result = await readinessService.reportCheck(sessionId, checkType, measurement || {});
  return res.status(200).json({ success: true, sessionId, ...result });
}

async function getStatus(req, res) {
  const { sessionId } = req.params;
  const status = await readinessService.getStatus(sessionId);
  return res.status(200).json({ success: true, sessionId, ...status });
}

module.exports = { reportCheck, getStatus };
