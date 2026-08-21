const llmClient = require("../interviewer/llmClient");

// docFiles/L3-02 §1. Tone rule from the spec, baked directly into the
// prompt: "must be presented as a supportive profile, never a definitive
// judgment of intelligence or competence."
const MIN_WORD_COUNT = 40;

const PROMPT_TEMPLATE = (candidateText) => `
You are producing a supportive language-usage profile for a candidate's own
interview preparation — never a judgment of their intelligence or overall
competence. Base every rating only on the transcript text below.

Candidate's combined spoken answers across the whole interview:
"""
${candidateText}
"""

Rate each dimension as one of "Good", "Moderate", or "Needs Improvement".
Respond with strict JSON only, no other text:
{
  "fluency": string,
  "vocabulary": string,
  "grammar": string,
  "clarity": string,
  "fillerWords": string,
  "answerStructure": string
}
Keep the wording descriptive and constructive, never harsh.
`.trim();

const INSUFFICIENT_DATA_PROFILE = {
  fluency: "Insufficient data",
  vocabulary: "Insufficient data",
  grammar: "Insufficient data",
  clarity: "Insufficient data",
  fillerWords: "Insufficient data",
  answerStructure: "Insufficient data",
};

// flatTranscript: transcriptAssembler.js's assembleTranscript().flatTranscript
async function profileLanguage(flatTranscript) {
  const candidateText = flatTranscript
    .filter((t) => t.speaker === "Candidate")
    .map((t) => t.text)
    .join(" ")
    .trim();

  // docFiles/L3-02 acceptance criteria: "use Insufficient data if the
  // transcript is too short for a dimension, never fabricate" — applied here
  // at the whole-profile level since a too-short transcript can't support
  // any of the six dimensions honestly.
  if (candidateText.split(/\s+/).filter(Boolean).length < MIN_WORD_COUNT) {
    return { ...INSUFFICIENT_DATA_PROFILE };
  }

  const result = await llmClient.generateJson(PROMPT_TEMPLATE(candidateText));
  return result ? { ...INSUFFICIENT_DATA_PROFILE, ...result } : { ...INSUFFICIENT_DATA_PROFILE };
}

module.exports = { profileLanguage };
