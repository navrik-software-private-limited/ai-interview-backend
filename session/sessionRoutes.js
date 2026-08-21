const express = require("express");
const { verifyInternalServiceKey } = require("../middleware/verifyInternalServiceKey");
const { verifyInterviewAccessTokenHttpMiddleware } = require("../middleware/verifyInterviewAccessToken");
const { createSession, joinSession } = require("./sessionCreationController");

const router = express.Router();

router.post("/", verifyInternalServiceKey, createSession);
router.post("/:sessionId/join", verifyInterviewAccessTokenHttpMiddleware, joinSession);

module.exports = router;
