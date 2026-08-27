const llmClient = require("../interviewer/llmClient");

// doc 04 §2's six follow-up triggers, used verbatim in the prompt. Capping at
// one follow-up per question (enforced by the caller, not here) is what
// satisfies the doc's "avoid unnecessary repetitive follow-ups" constraint.
const PROMPT_TEMPLATE = (question, answer) => `
You are deciding whether an AI interviewer should ask ONE follow-up question
after a candidate's answer. A follow-up is warranted only if at least one of
these is true:
- The answer lacks depth.
- The answer is ambiguous.
- The candidate makes a claim that needs validation.
- The candidate contradicts something said earlier.
- The interview objective requires deeper evidence.
- The candidate gave an interesting technical direction worth probing.

Be conservative — most reasonably complete answers do NOT need a follow-up.

Question: "${question}"
Candidate's answer: "${answer}"

Respond with strict JSON only, no other text: {"followUp": boolean, "reason": string}
`.trim();

async function shouldFollowUp(question, answer, { signal } = {}) {
  const result = await llmClient.generateJson(PROMPT_TEMPLATE(question, answer), { signal });
  if (!result || typeof result.followUp !== "boolean") {
    // Fail safe: if the model didn't comply, don't follow up — matches the
    // "be conservative" instruction rather than drilling the candidate.
    return { followUp: false, reason: "decision_unavailable" };
  }
  return result;
}

module.exports = { shouldFollowUp };
