const llmClient = require("../interviewer/llmClient");

// 03-LIVE-INTERVIEW-MODULE.md §9: analyzes a code submission against its
// problem statement. IMPORTANT scope boundary — there is no sandboxed
// execution environment (see database/schema.sql's comment on
// interview_coding_submissions.evaluation): "correctness_assessment" here is
// the LLM's best-judgment reading of the code, NOT an execution-verified
// test result. This is an intentional, documented limitation, not a bug.
const PROMPT_TEMPLATE = ({ statement, code, language }) => `
You are an AI interviewer analyzing a candidate's code submission during a mock
coding interview. You are reading the code, not running it — there is no
execution environment available. Be honest that your correctness assessment
is a reasoned judgment, not a verified test result.

Problem statement: "${statement}"
Language: ${language || "unspecified"}
Candidate's code:
"""
${code}
"""

Assess the submission and respond with strict JSON only, no other text:
{
  "correctness_assessment": string,
  "approach_quality": string,
  "edge_case_handling": string,
  "code_quality": string,
  "explanation_needed": string | null
}
Set "explanation_needed" to a short, specific question worth asking the
candidate to explain further, or null if nothing stands out.
`.trim();

const FALLBACK_EVALUATION = {
  correctness_assessment: "Evaluation unavailable — the model did not return a usable response.",
  approach_quality: null,
  edge_case_handling: null,
  code_quality: null,
  explanation_needed: null,
};

async function evaluateSubmission({ statement, code, language }) {
  const result = await llmClient.generateJson(PROMPT_TEMPLATE({ statement, code, language }));
  return result || FALLBACK_EVALUATION;
}

module.exports = { evaluateSubmission };
