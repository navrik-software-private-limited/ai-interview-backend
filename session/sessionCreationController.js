const crypto = require("crypto");
const candidateRepository = require("./candidateRepository");
const sessionRepository = require("./sessionRepository");
const logger = require("../logs/logger");

// Service-to-service only (middleware/verifyInternalServiceKey.js) — trusts
// practywiz-backend completely. This endpoint never re-checks purchase
// ownership itself; that's practywiz-backend's job before it ever calls here
// (00-MASTER-ARCHITECTURE.md §2).
async function createSession(req, res) {
  const {
    candidateId,
    candidateName,
    candidateEmail,
    caseStudyId,
    caseStudyPurchaseId,
    caseType,
    caseContentText,
    resumeReference,
    jdReference,
    jdText,
    resumeFileName,
    jdFileName,
  } = req.body;

  if (!candidateId) {
    return res.status(400).json({ success: false, error: "candidateId is required" });
  }

  const sessionId = crypto.randomUUID();
  const interviewId = crypto.randomUUID();

  try {
    await candidateRepository.upsertCandidateReference({
      candidateId,
      name: candidateName,
      email: candidateEmail,
    });

    await sessionRepository.insertInterviewSessionRow({
      sessionId,
      candidateId,
      interviewId,
      caseStudyId,
      caseStudyPurchaseId,
    });

    // Shape matches what communication/socketServer.js's
    // buildAndCacheResumeContext already reads (.caseContentText, .jdText).
    await sessionRepository.insertInterviewSessionContextRow(sessionId, {
      resumeReference,
      jdReference,
      contextSnapshot: {
        caseStudyId: caseStudyId || null,
        caseStudyPurchaseId: caseStudyPurchaseId || null,
        caseType: caseType || null,
        jdText: jdText || null,
        caseContentText: caseContentText || null,
        // Interview Dashboard – Resume & JD Integration Requirement.md §15 —
        // display-only filenames for the Reports tab (fetchSessionsForCandidate
        // in session/sessionRepository.js reads these back out).
        resumeFileName: resumeFileName || null,
        jdFileName: jdFileName || null,
      },
    });

    sessionRepository.insertSessionCreatedRow(sessionId, {
      path: "case-study-purchase",
      caseStudyPurchaseId: caseStudyPurchaseId || null,
      caseStudyId: caseStudyId || null,
    }); // fire-and-forget audit write

    return res.status(201).json({ success: true, sessionId, interviewId });
  } catch (error) {
    logger.error("createSession error:", error.message);
    return res.status(500).json({ success: false, error: "Failed to create interview session" });
  }
}

// 03-LIVE-INTERVIEW-MODULE.md §2.2's literal pre-WS HTTP validation step.
// The interview access token (verifyInterviewAccessTokenHttpMiddleware) is
// the real authorization check; this just confirms the session is actually
// in a joinable state before the frontend bothers opening the WebSocket.
async function joinSession(req, res) {
  const { sessionId } = req.params;
  const status = await sessionRepository.fetchSessionStatus(sessionId);

  if (status !== "READY" && status !== "ACTIVE") {
    return res.status(409).json({
      success: false,
      error: "Session is not ready to join",
      status: status || "UNKNOWN",
    });
  }

  return res.status(200).json({ success: true, sessionId, status, iceServers: [] });
}

module.exports = { createSession, joinSession };
