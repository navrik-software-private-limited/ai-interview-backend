// Half-duplex turn gate. Without this, the candidate's mic (picking up
// speaker bleed/echo of the AI's own voice, or just background noise) keeps
// getting fed into the VAD *while the AI is speaking*, which can trigger a
// second reply before the first has finished playing — two playback calls
// pushing audio onto the same outbound track at once, which is what sounds
// like "the AI's voice going noisy/interfered with another voice".
//
// In-memory (not Redis) because this is read on every ~10ms inbound audio
// frame — it must be synchronous and fast, not a network round-trip.

const aiBusyBySession = new Map();

function setAiBusy(sessionId) {
  aiBusyBySession.set(sessionId, true);
}

// Releases the gate after a short delay rather than immediately, so the
// room's echo/reverb tail from the AI's own speech has time to decay before
// the candidate's mic is "believed" again.
const RELEASE_DELAY_MS = 400;
function releaseAiBusy(sessionId, delayMs = RELEASE_DELAY_MS) {
  setTimeout(() => aiBusyBySession.delete(sessionId), delayMs);
}

function isAiBusy(sessionId) {
  return aiBusyBySession.get(sessionId) === true;
}

function clearSession(sessionId) {
  aiBusyBySession.delete(sessionId);
}

module.exports = { setAiBusy, releaseAiBusy, isAiBusy, clearSession };
