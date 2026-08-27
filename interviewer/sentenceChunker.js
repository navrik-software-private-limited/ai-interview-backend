// doc/real_time_interview_communication_improvement.md Phase 6/§13: splits an
// incrementally-growing LLM text buffer into complete sentences as soon as
// they're known, so TTS can start on sentence 1 while the model is still
// generating sentence 2+. Best-effort, not a full NLP sentence-boundary
// detector — matches the improvement doc's own "avoid unnatural fragments,"
// not "handle every edge case." Pure function, no LLM call per pause (the
// doc explicitly warns against that) — just local string logic.

// Common abbreviations whose trailing "." is not a sentence end. Checked
// against the word immediately before the period, lowercased.
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st",
  "vs", "etc", "e.g", "i.e", "u.s", "u.k", "no",
]);

// Guards against splitting on a period that's part of a short fragment
// (an abbreviation this list doesn't happen to cover, an initial like "A.")
// rather than a real sentence end.
const MIN_SENTENCE_LENGTH = 8;

function lastWord(text) {
  const match = text.match(/(\S+)$/);
  return match ? match[1].toLowerCase().replace(/\.+$/, "") : "";
}

// buffer: the full text accumulated so far for this response (not just the
// latest delta). Returns every complete sentence found from the start of
// `buffer` up to the last confirmed boundary, plus whatever's left over
// (not yet known to be complete) as `remainder`. Called repeatedly as more
// text streams in — remainder is what the caller keeps accumulating into.
function extractCompleteSentences(buffer) {
  const sentences = [];
  let start = 0;

  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;

    // A period/!/? is only a confirmed sentence boundary once we've seen
    // whitespace after it — anything still directly attached to more
    // characters (a decimal like "3.14", an abbreviation mid-stream like
    // "U.S.") isn't decidable yet, and the period at the very end of the
    // buffer-so-far isn't either (more text may still be coming).
    const nextChar = buffer[i + 1];
    if (nextChar === undefined || !/\s/.test(nextChar)) continue;

    const candidate = buffer.slice(start, i + 1).trim();
    if (candidate.length < MIN_SENTENCE_LENGTH) continue;

    const wordBeforePunctuation = lastWord(candidate.slice(0, -1));
    if (ABBREVIATIONS.has(wordBeforePunctuation)) continue;

    sentences.push(candidate);
    start = i + 1;
  }

  // Trim only the leading whitespace left right after a confirmed split
  // point (the one that proved it was a real boundary) — not anything
  // trailing, which could still matter once more text streams in.
  return { sentences, remainder: buffer.slice(start).replace(/^\s+/, "") };
}

module.exports = { extractCompleteSentences };
