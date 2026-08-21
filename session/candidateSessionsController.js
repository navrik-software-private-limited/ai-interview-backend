const sessionRepository = require("./sessionRepository");
const logger = require("../logs/logger");

// Interview Dashboard – Resume & JD Integration Requirement.md §15/§18: the
// Reports tab's data source. Service-to-service only (verifyInternalServiceKey,
// see candidateSessionsRoutes.js) — practywiz-backend has already
// authenticated the real user and passes their own candidateId, mirroring
// exactly how admin/adminConfigRoutes.js trusts practywiz-backend's own
// admin-role check.
async function listSessionsForCandidate(req, res) {
  const { candidateId } = req.params;
  if (!candidateId) {
    return res.status(400).json({ success: false, error: "candidateId is required" });
  }

  try {
    const sessions = await sessionRepository.fetchSessionsForCandidate(Number(candidateId));
    return res.status(200).json({ success: true, sessions });
  } catch (error) {
    logger.error("listSessionsForCandidate error:", error.message);
    return res.status(500).json({ success: false, error: "Failed to load sessions" });
  }
}

module.exports = { listSessionsForCandidate };
