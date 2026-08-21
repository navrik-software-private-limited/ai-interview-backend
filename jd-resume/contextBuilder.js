const llmClient = require("../interviewer/llmClient");
const logger = require("../logs/logger");

// doc 04 §6's structured shape — always returned, even on LLM failure, so
// callers (question-engine) never need to null-check individual fields.
const EMPTY_CONTEXT = {
  skills: [],
  experience_claims: [],
  role_requirements: [],
  knowledge_areas: [],
  question_targets: [],
};

// Single LLM call turning raw resume/JD text into a structured brief the
// JD_RESUME question-generation prompt can use directly. Safe to call with
// only one of the two texts (or neither, in which case it returns null and
// the caller falls back to fully generic questions — existing behavior).
async function buildResumeContext({ resumeText, jdText }) {
  if (!resumeText && !jdText) return null;

  const prompt = `You are analyzing a candidate's resume and (optionally) a target job description ahead of a mock interview.

Resume text:
"""
${resumeText || "(not provided)"}
"""

Job description:
"""
${jdText || "(not provided)"}
"""

Return STRICT JSON with this exact shape:
{
  "skills": string[],               // key technical/domain skills evidenced in the resume
  "experience_claims": string[],    // specific claims worth probing (projects, achievements, metrics)
  "role_requirements": string[],    // requirements from the JD not clearly evidenced in the resume (empty array if no JD provided)
  "knowledge_areas": string[],      // domains/technologies worth testing knowledge of
  "question_targets": string[]      // 5-8 concrete interview question angles combining the above
}
Keep every array item short (under 15 words). Do not include any text outside the JSON object.`;

  const result = await llmClient.generateJson(prompt);
  if (!result) {
    logger.warn("buildResumeContext: LLM returned no usable JSON, falling back to empty context");
    return EMPTY_CONTEXT;
  }
  return { ...EMPTY_CONTEXT, ...result };
}

module.exports = { buildResumeContext, EMPTY_CONTEXT };
