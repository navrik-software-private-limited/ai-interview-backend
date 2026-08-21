const llmClient = require("../interviewer/llmClient");

// docFiles/L3-05 §2. Rule: "every recommendation must be generated from
// actual weaknesses identified during the interview — no generic boilerplate
// advice unconnected to the session." Enforced in code below (any note
// missing a linkedWeakness is dropped), not just requested in the prompt.
const PROMPT_TEMPLATE = (weaknesses) => `
You are generating concrete interview-preparation recommendations for a
candidate, based ONLY on the weaknesses actually identified below — no
generic advice unrelated to these.

Weaknesses identified:
${weaknesses.map((w, i) => `${i + 1}. ${w}`).join("\n")}

Respond with strict JSON only, no other text:
{ "notes": [{"recommendation": string, "linkedWeakness": string}] }
"linkedWeakness" must be the exact text (or a close paraphrase) of one of the
weaknesses above. Omit any note you cannot ground this way.
`.trim();

function hasValidLink(note, weaknesses) {
  if (!note || typeof note.recommendation !== "string" || !note.recommendation.trim()) return false;
  if (typeof note.linkedWeakness !== "string" || !note.linkedWeakness.trim()) return false;
  return weaknesses.length === 0 || weaknesses.some((w) => w.toLowerCase().includes(note.linkedWeakness.toLowerCase().slice(0, 20)) || note.linkedWeakness.toLowerCase().includes(w.toLowerCase().slice(0, 20)));
}

async function generatePreparationNotes(weaknesses) {
  if (!weaknesses.length) return [];

  const result = await llmClient.generateJson(PROMPT_TEMPLATE(weaknesses));
  const notes = Array.isArray(result?.notes) ? result.notes : [];
  return notes.filter((n) => hasValidLink(n, weaknesses));
}

module.exports = { generatePreparationNotes };
