const env = require("../config/env");

// doc/07_INTERVIEW_MODULE_STATUS_AND_ROADMAP.md gap #3: single source of
// truth for RTCConfiguration.iceServers, used both server-side
// (peerConnectionManager.js's own RTCPeerConnection) and handed to the
// browser (communication/socketServer.js's session.ready payload,
// session/sessionCreationController.js's joinSession response) so both ends
// of the connection see identical STUN/TURN config.
//
// STUN-only until all three TURN_* env vars are set — a partially-configured
// TURN (e.g. urls without credentials) is treated as "not configured" rather
// than emitting a broken TURN entry, since a malformed entry is worse than
// no TURN entry at all (the browser would just fail to use it either way).
function getIceServers() {
  const servers = env.webrtc.stunUrls.map((urls) => ({ urls }));

  if (env.webrtc.turnUrls.length && env.webrtc.turnUsername && env.webrtc.turnCredential) {
    servers.push({
      urls: env.webrtc.turnUrls,
      username: env.webrtc.turnUsername,
      credential: env.webrtc.turnCredential,
    });
  }

  return servers;
}

module.exports = { getIceServers };
