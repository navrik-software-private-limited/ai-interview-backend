const env = require("../config/env");

// Service-to-service boundary for practywiz-backend -> ai-interview-backend
// calls (currently just POST /api/sessions). Shared-secret header, not a JWT —
// this endpoint trusts practywiz-backend completely (it never re-checks
// purchase ownership itself, per 00-MASTER-ARCHITECTURE.md §2's "no direct
// database joins... all cross-service data flows through API calls").
function verifyInternalServiceKey(req, res, next) {
  const key = req.headers["x-internal-service-key"];
  if (!key || key !== env.internalServiceKey) {
    return res.status(401).json({ success: false, error: "unauthorized" });
  }
  next();
}

module.exports = { verifyInternalServiceKey };
