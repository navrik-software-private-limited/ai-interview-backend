const sessionRepository = require("./sessionRepository");
const logger = require("../logs/logger");

// Interview Dashboard – Resume & JD Integration Requirement.md §15/§18: the
// Reports tab's data source. Service-to-service only (verifyInternalServiceKey,
// see candidateSessionsRoutes.js) — practywiz-backend has already
// authenticated the real user and passes their own candidateId, mirroring
// exactly how admin/adminConfigRoutes.js trusts practywiz-backend's own
// admin-role check.
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

// doc/07 gap #8: page/limit are optional so any caller that omits them still
// gets a sane default page (1) rather than an error.
function parsePageParams(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));
  return { page, limit };
}

async function listSessionsForCandidate(req, res) {
  const { candidateId } = req.params;
  if (!candidateId) {
    return res.status(400).json({ success: false, error: "candidateId is required" });
  }

  const { page, limit } = parsePageParams(req.query);

  try {
    const { sessions, total } = await sessionRepository.fetchSessionsForCandidate(Number(candidateId), { page, limit });
    return res.status(200).json({ success: true, sessions, total, page, limit });
  } catch (error) {
    logger.error("listSessionsForCandidate error:", error.message);
    return res.status(500).json({ success: false, error: "Failed to load sessions" });
  }
}

module.exports = { listSessionsForCandidate };
