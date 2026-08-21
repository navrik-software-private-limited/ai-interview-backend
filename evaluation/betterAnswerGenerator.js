const llmClient = require("../interviewer/llmClient");
const evaluationRepository = require("../evaluation/evaluationRepository");
const logger = require("../logs/logger");

// docFiles/L3-04 §2. Only runs for questions scoring below the threshold —
// "avoid generating unnecessary content for already-strong answers" is an
// explicit acceptance criterion, so this is a real cost-saving filter, not
// just a nicety.
const SCORE_THRESHOLD = 7;

const PROMPT_TEMPLATE = ({ section, questionText, answerText }) => `
You are writing a model "better answer" for a candidate's interview
preparation. The improved answer MUST stay at the same difficulty/knowledge
level expected for this question — never inflate it beyond what an
entry/mid-level candidate in this section would reasonably be expected to
know.

Section: ${section}
Question: "${questionText}"
Candidate's actual answer: "${answerText || "(no answer captured)"}"

Respond with strict JSON only, no other text:
{ "betterAnswer": string }
`.trim();

// questionEvaluations: rows as persisted by questionEvaluator.js (each has
// `id` = the interview_question_evaluations row id, needed to write back).
async function generateBetterAnswers(questionEvaluations) {
  const belowThreshold = questionEvaluations.filter(
    (q) => typeof q.score === "number" && q.score < SCORE_THRESHOLD
  );

  const results = [];
  for (const evaluation of belowThreshold) {
    // Sequential — same reasoning as questionEvaluator.js, this runs
    // unattended post-session so latency doesn't matter, and sequential
    // calls are gentler on rate limits than firing them all at once.
    // eslint-disable-next-line no-await-in-loop
    const result = await llmClient.generateJson(
      PROMPT_TEMPLATE({
        section: evaluation.section,
        questionText: evaluation.questionText,
        answerText: evaluation.answerText,
      })
    );
    const betterAnswer = result?.betterAnswer;
    if (!betterAnswer) {
      logger.warn(`betterAnswerGenerator: no usable response for question evaluation ${evaluation.id}`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await evaluationRepository.updateBetterAnswer(evaluation.id, betterAnswer);
    results.push({ questionEvaluationId: evaluation.id, betterAnswer });
  }
  return results;
}

module.exports = { generateBetterAnswers, SCORE_THRESHOLD };
