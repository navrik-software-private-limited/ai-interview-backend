const proctoringService = require("../proctoringService");

// doc/07_INTERVIEW_MODULE_STATUS_AND_ROADMAP.md gap #4 / docFiles/L2-05
// §5+§6: connectivity-monitor source. Unlike face-tracking, there is no
// dedicated client-side detector here — the underlying conditions (WebRTC
// media degrading/failing, socket disconnect/abandonment) are already
// detected server-side in webrtc/peerConnectionManager.js and
// communication/socketServer.js; this is just where they get forwarded into
// Proctoring, same thin pass-through shape as sources/faceEventAdapter.js.
async function forwardConnectivityEvent(io, sessionId, { eventType, severity, metadata = null }) {
  return proctoringService.recordEvent(io, sessionId, {
    source: "connectivity-monitor",
    eventType,
    severity,
    metadata,
  });
}

module.exports = { forwardConnectivityEvent };
