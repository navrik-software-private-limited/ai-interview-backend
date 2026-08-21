const express = require("express");
const { verifyInterviewAccessTokenHttpMiddleware } = require("../middleware/verifyInterviewAccessToken");
const { getProctoringEvents } = require("./proctoringController");

const router = express.Router();

router.get("/:sessionId/events", verifyInterviewAccessTokenHttpMiddleware, getProctoringEvents);

module.exports = router;
