const llmClient = require("../interviewer/llmClient");
const evaluationRepository = require("../evaluation/evaluationRepository");
const logger = require("../logs/logger");

// docFiles/L3-03: technical + theoretical + question-level analysis, all in
// one per-question LLM call. The generic spec treats "technical" and
// "theoretical" as separate evaluation passes, but this codebase's questions
// aren't tagged with that distinction anywhere (only section: JD_RESUME/
// APTITUDE/CASE/MINDSET) — running two LLM calls per question to split a
// distinction the real data doesn't structurally carry would double cost/
// latency for no real gain, so `sectionHint` lets one call weigh practical
// vs. conceptual understanding as appropriate for that section instead.
//
// CODING is deliberately excluded here — coding/codeEvaluator.js already
// produces an LLM-judged evaluation per submission at submit time; this
// module reuses that as-is rather than re-scoring it (see reportAssembler.js).
const PROMPT_TEMPLATE = ({ section, questionText, answerText }) => `
You are evaluating one question from a completed AI mock interview, for the
candidate's own preparation (not a hiring decision). Section: ${section}.

Question asked: "${questionText}"
Candidate's answer: "${answerText || "(no answer captured)"}"

Evaluate the answer for both practical/technical understanding and
theoretical/conceptual correctness as appropriate for this section. Respond
with strict JSON only, no other text:
{
  "score": number,               // 0-10
  "whatWasGood": string[],
  "whatCouldImprove": string[],
  "understandingLevel": string,  // e.g. "strong" | "good" | "partial" | "weak" | "insufficient_data"
  "improvementSuggestion": string // always present, even for a high score (can be a minor refinement)
}
If the candidate's answer is empty or clearly insufficient to judge, set
"understandingLevel" to "insufficient_data" rather than guessing a score.
`.trim();

const FALLBACK_EVALUATION = {
  score: null,
  whatWasGood: [],
  whatCouldImprove: [],
  understandingLevel: "insufficient_data",
  improvementSuggestion: null,
};

async function evaluateQuestion({ section, questionText, answerText }) {
  const result = await llmClient.generateJson(PROMPT_TEMPLATE({ section, questionText, answerText }));
  if (!result) {
    logger.warn(`questionEvaluator: LLM returned no usable JSON for question "${questionText.slice(0, 60)}..."`);
    return { ...FALLBACK_EVALUATION };
  }
  return { ...FALLBACK_EVALUATION, ...result };
}

// Interview Room MCQ interaction type: an MCQ has one objectively correct
// answer — routing a single selected letter through the same free-text
// LLM-judgment prompt above would be both slower (an LLM call per question)
// and weaker (non-deterministic phrasing of what should be an exact-match
// check). Deterministic, no LLM call at all.
function evaluateMcqQuestion(node) {
  if (!node.selectedOption) {
    // Skipped (handleSkip) rather than answered — never fabricate a score.
    return { ...FALLBACK_EVALUATION };
  }
  const isCorrect = node.selectedOption === node.correctOption;
  return {
    score: isCorrect ? 10 : 0,
    whatWasGood: isCorrect ? ["Selected the correct option"] : [],
    whatCouldImprove: isCorrect ? [] : ["Selected option did not match the correct answer"],
    understandingLevel: isCorrect ? "correct" : "incorrect",
    improvementSuggestion: isCorrect ? null : `Review this topic — the correct answer was option ${node.correctOption}.`,
  };
}

// Evaluates every question in the assembled Q&A tree (flattening follow-ups
// alongside their parent — each is its own scoreable exchange), persists one
// row per question, and returns the flat list of persisted evaluations for
// downstream modules (scoringAggregator, strengthsWeaknessesAnalyzer, etc.).
async function evaluateAllQuestions(sessionId, questionAnswerTree) {
  const flat = [];
  function flatten(nodes) {
    for (const node of nodes) {
      flat.push(node);
      if (node.followUps?.length) flatten(node.followUps);
    }
  }
  flatten(questionAnswerTree);

  const results = [];
  for (const node of flat) {
    // Sequential, not Promise.all — this pipeline already runs unattended
    // after the candidate has left, so latency here doesn't affect anyone's
    // live experience; sequential calls are gentler on LLM rate limits than
    // firing a whole interview's worth of questions at once.
    // eslint-disable-next-line no-await-in-loop
    const evaluation =
      node.interactionType === "MCQ"
        ? evaluateMcqQuestion(node)
        : await evaluateQuestion({
            section: node.section,
            questionText: node.questionText,
            answerText: node.answerText,
          });
    // eslint-disable-next-line no-await-in-loop
    const id = await evaluationRepository.insertQuestionEvaluation(sessionId, node.questionAskedId, {
      section: node.section,
      questionText: node.questionText,
      answerText: node.answerText,
      ...evaluation,
    });
    results.push({
      id,
      questionAskedId: node.questionAskedId,
      section: node.section,
      questionText: node.questionText,
      answerText: node.answerText,
      ...evaluation,
    });
  }
  return results;
}

module.exports = { evaluateAllQuestions };
