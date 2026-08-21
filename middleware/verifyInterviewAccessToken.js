const jwt = require("jsonwebtoken");
const env = require("../config/env");

// Socket.IO auth middleware — verifies the short-lived interview access token
// issued by practywiz-backend's POST /api/v1/interview-engine/sessions.
function verifyInterviewAccessTokenSocketMiddleware(socket, next) {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error("unauthorized"));

  jwt.verify(token, env.jwtInterviewAccessTokenSecretKey, (err, decoded) => {
    if (err) return next(new Error("unauthorized"));

    const requestedSessionId = socket.handshake.auth.sessionId;
    if (requestedSessionId && requestedSessionId !== decoded.sessionId) {
      return next(new Error("unauthorized"));
    }

    socket.data.session = {
      sessionId: decoded.sessionId,
      interviewId: decoded.interviewId,
      candidateId: decoded.candidateId,
      permissions: decoded.permissions || [],
    };
    next();
  });
}

// Express (REST) equivalent of the socket middleware above — same token,
// same secret, same session-id-match check. Used by the proctoring events
// GET route so a session's proctoring evidence can't be fetched by anyone who
// just happens to know the session id.
function verifyInterviewAccessTokenHttpMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, error: "unauthorized" });

  jwt.verify(token, env.jwtInterviewAccessTokenSecretKey, (err, decoded) => {
    if (err) return res.status(401).json({ success: false, error: "unauthorized" });

    if (req.params.sessionId && req.params.sessionId !== decoded.sessionId) {
      return res.status(403).json({ success: false, error: "forbidden" });
    }

    req.interviewSession = {
      sessionId: decoded.sessionId,
      interviewId: decoded.interviewId,
      candidateId: decoded.candidateId,
      permissions: decoded.permissions || [],
    };
    next();
  });
}

module.exports = { verifyInterviewAccessTokenSocketMiddleware, verifyInterviewAccessTokenHttpMiddleware };
