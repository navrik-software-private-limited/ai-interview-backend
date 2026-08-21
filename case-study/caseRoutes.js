const express = require("express");
const { verifyInterviewAccessTokenHttpMiddleware } = require("../middleware/verifyInterviewAccessToken");
const { getCase } = require("./caseHttpController");

const router = express.Router();

router.get("/:sessionId/case", verifyInterviewAccessTokenHttpMiddleware, getCase);

module.exports = router;
