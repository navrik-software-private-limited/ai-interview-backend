jest.mock("../../../config/env", () => ({
  jwtInterviewAccessTokenSecretKey: "test-secret",
}));

const jwt = require("jsonwebtoken");
const {
  verifyInterviewAccessTokenSocketMiddleware,
  verifyInterviewAccessTokenHttpMiddleware,
} = require("../../../middleware/verifyInterviewAccessToken");

const SECRET = "test-secret";

function signToken(payload, secret = SECRET) {
  return jwt.sign(payload, secret);
}

describe("middleware/verifyInterviewAccessToken", () => {
  describe("socket middleware", () => {
    test("rejects a connection with no token", () => {
      const socket = { handshake: { auth: {} }, data: {} };
      const next = jest.fn();
      verifyInterviewAccessTokenSocketMiddleware(socket, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test("rejects a token signed with the wrong secret", () => {
      const token = signToken({ sessionId: "s1" }, "wrong-secret");
      const socket = { handshake: { auth: { token } }, data: {} };
      const next = jest.fn();
      verifyInterviewAccessTokenSocketMiddleware(socket, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test("rejects when the handshake's requested sessionId doesn't match the token's", () => {
      const token = signToken({ sessionId: "s1", interviewId: "i1", candidateId: "c1" });
      const socket = { handshake: { auth: { token, sessionId: "s2" } }, data: {} };
      const next = jest.fn();
      verifyInterviewAccessTokenSocketMiddleware(socket, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test("accepts a valid token and attaches the decoded session to socket.data", () => {
      const token = signToken({ sessionId: "s1", interviewId: "i1", candidateId: "c1", permissions: ["join"] });
      const socket = { handshake: { auth: { token, sessionId: "s1" } }, data: {} };
      const next = jest.fn();
      verifyInterviewAccessTokenSocketMiddleware(socket, next);
      expect(next).toHaveBeenCalledWith(); // no error
      expect(socket.data.session).toEqual({
        sessionId: "s1",
        interviewId: "i1",
        candidateId: "c1",
        permissions: ["join"],
      });
    });

    test("defaults permissions to [] when absent from the token", () => {
      const token = signToken({ sessionId: "s1", interviewId: "i1", candidateId: "c1" });
      const socket = { handshake: { auth: { token } }, data: {} };
      const next = jest.fn();
      verifyInterviewAccessTokenSocketMiddleware(socket, next);
      expect(socket.data.session.permissions).toEqual([]);
    });
  });

  describe("HTTP middleware", () => {
    function mockRes() {
      const res = {};
      res.status = jest.fn(() => res);
      res.json = jest.fn(() => res);
      return res;
    }

    test("401s when no Authorization header is present", () => {
      const req = { headers: {}, params: {} };
      const res = mockRes();
      const next = jest.fn();
      verifyInterviewAccessTokenHttpMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test("401s on an invalid token", () => {
      const req = { headers: { authorization: "Bearer not-a-real-token" }, params: {} };
      const res = mockRes();
      const next = jest.fn();
      verifyInterviewAccessTokenHttpMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test("403s when the route's :sessionId param doesn't match the token's session (no cross-session access)", () => {
      const token = signToken({ sessionId: "s1", interviewId: "i1", candidateId: "c1" });
      const req = { headers: { authorization: `Bearer ${token}` }, params: { sessionId: "someone-elses-session" } };
      const res = mockRes();
      const next = jest.fn();
      verifyInterviewAccessTokenHttpMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test("calls next() and attaches req.interviewSession on a valid, matching token", () => {
      const token = signToken({ sessionId: "s1", interviewId: "i1", candidateId: "c1" });
      const req = { headers: { authorization: `Bearer ${token}` }, params: { sessionId: "s1" } };
      const res = mockRes();
      const next = jest.fn();
      verifyInterviewAccessTokenHttpMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.interviewSession.sessionId).toBe("s1");
    });
  });
});
