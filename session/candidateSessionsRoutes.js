const express = require("express");
const { verifyInternalServiceKey } = require("../middleware/verifyInternalServiceKey");
const { listSessionsForCandidate } = require("./candidateSessionsController");

const router = express.Router();

router.get("/:candidateId/sessions", verifyInternalServiceKey, listSessionsForCandidate);

module.exports = router;
