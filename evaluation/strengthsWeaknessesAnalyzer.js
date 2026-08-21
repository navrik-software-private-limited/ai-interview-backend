const llmClient = require("../interviewer/llmClient");

// docFiles/L3-01 §3/§4. Acceptance criterion: "every strength/weakness bullet
// references at least one underlying question or event" — enforced in code
// below (any bullet missing a questionRef is dropped), not just requested in
// the prompt, since a model can't be trusted to reliably self-enforce a
// citation requirement.
const PROMPT_TEMPLATE = ({ questionEvaluations, softSkills, languageProfile }) => `
You are identifying a candidate's strongest and weakest areas from a
completed mock interview, for their own preparation. Every bullet MUST be
grounded in one of the specific items below — never generic filler.

Question-level evaluations:
${questionEvaluations
  .map((q, i) => `${i + 1}. [section=${q.section}, questionAskedId=${q.questionAskedId}] "${q.questionText}" -> score: ${q.score ?? "n/a"}/10; good: ${(q.whatWasGood || []).join("; ") || "none"}; improve: ${(q.whatCouldImprove || []).join("; ") || "none"}`)
  .join("\n")}

Soft skills: ${JSON.stringify(softSkills)}
Language profile: ${JSON.stringify(languageProfile)}

Respond with strict JSON only, no other text:
{
  "strengths": [{"text": string, "questionRef": string}],
  "weaknesses": [{"text": string, "questionRef": string}]
}
"questionRef" MUST be one of the questionAskedId values above, or a soft-skill/
language-profile dimension name if the bullet is about one of those instead of
a specific question. Every bullet must have a non-empty questionRef — omit any
bullet you cannot ground this way.
`.trim();

function hasValidRef(bullet) {
  return Boolean(bullet && typeof bullet.text === "string" && bullet.text.trim() && bullet.questionRef);
}

async function analyzeStrengthsWeaknesses({ questionEvaluations, softSkills, languageProfile }) {
  const result = await llmClient.generateJson(PROMPT_TEMPLATE({ questionEvaluations, softSkills, languageProfile }));

  const strengths = Array.isArray(result?.strengths) ? result.strengths.filter(hasValidRef) : [];
  const weaknesses = Array.isArray(result?.weaknesses) ? result.weaknesses.filter(hasValidRef) : [];

  return {
    strengths: strengths.map((s) => s.text),
    weaknesses: weaknesses.map((w) => w.text),
    // Kept alongside the plain-text arrays (which is what interview_evaluations
    // persists, matching Module 01's Report.strengths/weaknesses: string[])
    // so reportAssembler.js and preparationNotesGenerator.js can still trace
    // each bullet back to its question/dimension without re-parsing text.
    strengthsWithRefs: strengths,
    weaknessesWithRefs: weaknesses,
  };
}

module.exports = { analyzeStrengthsWeaknesses };
