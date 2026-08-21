const express = require("express");
const { verifyInterviewAccessTokenHttpMiddleware } = require("../middleware/verifyInterviewAccessToken");
const { reportCheck, getStatus } = require("./readinessController");

const router = express.Router();

router.post("/:sessionId/readiness/check", verifyInterviewAccessTokenHttpMiddleware, reportCheck);
router.get("/:sessionId/readiness/status", verifyInterviewAccessTokenHttpMiddleware, getStatus);

module.exports = router;
