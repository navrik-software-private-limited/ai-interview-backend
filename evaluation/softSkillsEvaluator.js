const llmClient = require("../interviewer/llmClient");
const { applyEvidenceThreshold } = require("./evidenceThreshold");

// docFiles/L3-02 §2. Evidence pool = full transcript + the per-question
// evaluations already produced by questionEvaluator.js (whatWasGood/
// whatCouldImprove give the model concrete moments to cite rather than
// re-reading the raw transcript for everything).
const DIMENSIONS = [
  "communication",
  "confidence",
  "problemSolving",
  "leadership",
  "teamwork",
  "adaptability",
  "criticalThinking",
  "decisionMaking",
  "structuredThinking",
];

const PROMPT_TEMPLATE = ({ candidateText, questionEvaluations }) => `
You are evaluating a candidate's soft skills from a completed mock interview,
using ONLY evidence actually present below (not inferred from resume claims).

Candidate's combined spoken answers:
"""
${candidateText}
"""

Per-question evaluation notes:
${questionEvaluations
  .map((q, i) => `${i + 1}. [${q.section}] "${q.questionText}" -> good: ${(q.whatWasGood || []).join("; ") || "none noted"}; improve: ${(q.whatCouldImprove || []).join("; ") || "none noted"}`)
  .join("\n")}

For each dimension below, respond with strict JSON only, no other text:
{
  "communication": { "rating": string, "evidenceCount": number, "evidence": [{"note": string}] },
  "confidence": { "rating": string, "evidenceCount": number, "evidence": [{"note": string}] },
  "problemSolving": { "rating": string, "evidenceCount": number, "evidence": [{"note": string}] },
  "leadership": { "rating": string, "evidenceCount": number, "evidence": [{"note": string}] },
  "teamwork": { "rating": string, "evidenceCount": number, "evidence": [{"note": string}] },
  "adaptability": { "rating": string, "evidenceCount": number, "evidence": [{"note": string}] },
  "criticalThinking": { "rating": string, "evidenceCount": number, "evidence": [{"note": string}] },
  "decisionMaking": { "rating": string, "evidenceCount": number, "evidence": [{"note": string}] },
  "structuredThinking": { "rating": string, "evidenceCount": number, "evidence": [{"note": string}] }
}
"rating" must be one of "Strong", "Good", "Moderate evidence", or "Limited evidence".
Set "evidenceCount" honestly to how many distinct moments actually support this
dimension — do not inflate it to justify a confident rating.
`.trim();

function fallbackDimension() {
  return { rating: "Limited evidence", evidenceCount: 0, evidence: [] };
}

// flatTranscript: transcriptAssembler output; questionEvaluations: questionEvaluator output.
async function evaluateSoftSkills(flatTranscript, questionEvaluations) {
  const candidateText = flatTranscript
    .filter((t) => t.speaker === "Candidate")
    .map((t) => t.text)
    .join(" ")
    .trim();

  const result = await llmClient.generateJson(PROMPT_TEMPLATE({ candidateText, questionEvaluations }));

  const output = {};
  for (const dimension of DIMENSIONS) {
    const raw = result?.[dimension] || fallbackDimension();
    output[dimension] = applyEvidenceThreshold(raw);
  }
  return output;
}

module.exports = { evaluateSoftSkills, DIMENSIONS };
