// "Interview Room – Complete Interview Flow & Implementation Requirements.md"
// §13/§14: which interaction type (VOICE_QA | MCQ) the next question in a
// section should use — configurable per section via the admin
// dbo.interview_configurations row, defaulting to the doc's own §13 example
// table when a config/field is absent. Same override-with-fallback shape as
// sectionPlan.js's nextSection/targetQuestionsFor — never breaks on missing
// config.
//
// CODING isn't part of this axis at all (it's driven by its own
// submission-based flow, not askNextQuestion) and INTRO/COMPLETING never ask
// questions — this module is only ever consulted for JD_RESUME/APTITUDE/
// CASE/MINDSET.
const SECTION_DEFAULTS = {
  JD_RESUME: { interactionType: "VOICE_QA" },
  APTITUDE: { interactionType: "MCQ" },
  CASE: { interactionType: "MIXED" },
  MINDSET: { interactionType: "MIXED" },
};

// MIXED sections: strict alternation starting with MCQ (doc §7's own
// example: "Q1 -> MCQ, Q2 -> Voice, Q3 -> MCQ, Q4 -> Voice"), capped at
// `mcqCount` MCQ questions total — once that budget is used up, every
// remaining question in the section (even the ones that would otherwise
// land on an "MCQ slot") falls back to voice rather than erroring.
// `mcqCount` defaults to half the section's target question count (rounded
// down) when the admin configured MIXED without specifying it explicitly.
function interactionTypeForQuestion(section, indexInSection, targetQuestions, overrideConfig) {
  const config = (overrideConfig && overrideConfig[section]) || SECTION_DEFAULTS[section] || { interactionType: "VOICE_QA" };
  const interactionType = config.interactionType || "VOICE_QA";

  if (interactionType === "MCQ") return "MCQ";
  if (interactionType !== "MIXED") return "VOICE_QA";

  const mcqCount = typeof config.mcqCount === "number" ? config.mcqCount : Math.floor((targetQuestions || 0) / 2);
  const isEvenIndex = indexInSection % 2 === 0;
  const evenSlotRank = Math.floor(indexInSection / 2); // 0-based rank among even-indexed (MCQ-eligible) slots
  return isEvenIndex && evenSlotRank < mcqCount ? "MCQ" : "VOICE_QA";
}

module.exports = { interactionTypeForQuestion, SECTION_DEFAULTS };
