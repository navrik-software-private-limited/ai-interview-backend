const express = require("express");
const { verifyInternalServiceKey } = require("../middleware/verifyInternalServiceKey");
const { getReportInternal } = require("./reportController");

const router = express.Router();

// doc/07 gap #8: mirrors session/candidateSessionsRoutes.js's
// service-to-service pattern exactly — practywiz-backend has already
// authenticated the real user and ownership-checked the session; this trusts
// that the way admin/adminConfigRoutes.js trusts practywiz-backend's own
// admin-role check.
router.get("/:sessionId/report", verifyInternalServiceKey, getReportInternal);

module.exports = router;
