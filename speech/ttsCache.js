const ttsClient = require("./ttsClient");

// Interview Module – Bug, Gap & UI/UX Improvements.md §3: "pre-generation of
// predictable interviewer phrases" — an in-memory cache for the handful of
// fully-static strings this interview ever speaks verbatim (the greeting,
// the completion line). Every other utterance is LLM-generated and
// effectively unique per session, so this Map never grows beyond a couple
// of entries — no eviction policy needed. A cache hit skips the ElevenLabs
// round trip entirely for these two high-visibility moments (interview
// start, interview end).
const cache = new Map();

async function getOrSynthesize(text, { signal } = {}) {
  const cached = cache.get(text);
  if (cached) return cached;

  const pcm = await ttsClient.synthesizeSpeech(text, { signal });
  cache.set(text, pcm);
  return pcm;
}

module.exports = { getOrSynthesize };
