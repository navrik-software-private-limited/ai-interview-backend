const express = require("express");
const { verifyInternalServiceKey } = require("../middleware/verifyInternalServiceKey");
const { listConfigurations, createConfiguration, activateConfiguration } = require("./adminConfigController");

const router = express.Router();

// Service-to-service only — practywiz-backend is the one that checks the
// requester is actually an admin (verifyAdminTokenAndAuthorization); this
// service trusts that check completely, same boundary as POST /api/sessions.
router.get("/", verifyInternalServiceKey, listConfigurations);
router.post("/", verifyInternalServiceKey, createConfiguration);
router.post("/:id/activate", verifyInternalServiceKey, activateConfiguration);

module.exports = router;
