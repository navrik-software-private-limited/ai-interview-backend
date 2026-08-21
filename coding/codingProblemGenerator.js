const crypto = require("crypto");
const llmClient = require("../interviewer/llmClient");

// 03-LIVE-INTERVIEW-MODULE.md §9: one LLM call generating a coding problem
// statement — no question bank, generated ad hoc like question-engine's
// questionGenerator.js. previousTitles avoids repeating a problem within the
// same session (CODING's baseline is only 2 problems, so this is a light
// best-effort nudge, not a hard uniqueness guarantee).
const PROMPT_TEMPLATE = (previousTitles) => `
You are an AI interviewer presenting a coding problem to a candidate in a mock
technical interview. Generate ONE coding problem solvable in a single sitting
(e.g. sorting, searching, string manipulation, arrays, basic data structures,
simple algorithms) — not a multi-hour project, not a trick question.
${previousTitles.length ? `Do not repeat or closely resemble these already-asked problems: ${previousTitles.join(", ")}.` : ""}

Respond with strict JSON only, no other text:
{"title": string, "statement": string, "examples": string[], "constraints": string[]}
`.trim();

const FALLBACK_PROBLEM = {
  title: "Sort an Array",
  statement:
    "Write a function that sorts an array of integers in ascending order. Explain the time and space complexity of your approach.",
  examples: ["Input: [5, 2, 9, 1] -> Output: [1, 2, 5, 9]"],
  constraints: [],
};

async function generateProblem(previousTitles = []) {
  const result = await llmClient.generateJson(PROMPT_TEMPLATE(previousTitles));
  const problem = result && result.statement ? result : FALLBACK_PROBLEM;
  return { problemId: crypto.randomUUID(), ...problem };
}

module.exports = { generateProblem };
