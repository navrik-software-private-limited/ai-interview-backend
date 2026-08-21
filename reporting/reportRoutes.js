const express = require("express");
const { verifyInterviewAccessTokenHttpMiddleware } = require("../middleware/verifyInterviewAccessToken");
const { getReportStatus } = require("./reportStatusController");
const { getReport } = require("./reportController");

const router = express.Router();

router.get("/:sessionId/report/status", verifyInterviewAccessTokenHttpMiddleware, getReportStatus);
router.get("/:sessionId/report", verifyInterviewAccessTokenHttpMiddleware, getReport);

module.exports = router;
