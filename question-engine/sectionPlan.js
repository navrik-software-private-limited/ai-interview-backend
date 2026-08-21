// Section order + baseline question-count targets, matching
// doc/04_MODULE_WISE_DEVELOPMENT.md §2's defaults exactly. "These are
// configuration values, not hard-coded product rules" — kept here as a
// single easy-to-change object rather than scattered through the controller.
// A future iteration can source this per-session from interview_plans.configuration.

const SECTION_ORDER = ["INTRO", "JD_RESUME", "APTITUDE", "CASE", "CODING", "MINDSET", "COMPLETING"];

// CODING: 2 problems (03-LIVE-INTERVIEW-MODULE.md §9 baseline "~2-3,
// configurable"), LLM-analysis based — see coding/codeEvaluator.js for the
// honest "no sandbox, judged not executed" scope boundary.
const SECTION_TARGETS = {
  INTRO: 0,
  JD_RESUME: 8,
  APTITUDE: 9,
  CASE: 12,
  CODING: 2,
  MINDSET: 5,
  COMPLETING: 0,
};

// Interview Module – Bug, Gap & UI/UX Improvements.md §1: both functions
// take an optional override (the active admin/interview_configurations row,
// cached on the Redis session as sectionOrder/sectionTargets — see
// admin/adminConfigRepository.js + interviewController.js's startInterview).
// A missing/invalid override falls back to the hardcoded defaults above, so
// an empty configuration table never breaks a session.
function nextSection(currentSection, overrideOrder) {
  const order = Array.isArray(overrideOrder) && overrideOrder.length ? overrideOrder : SECTION_ORDER;
  const index = order.indexOf(currentSection);
  if (index === -1 || index === order.length - 1) return null;
  return order[index + 1];
}

function targetQuestionsFor(section, overrideTargets) {
  if (overrideTargets && typeof overrideTargets[section] === "number") return overrideTargets[section];
  return SECTION_TARGETS[section] ?? 0;
}

module.exports = { SECTION_ORDER, SECTION_TARGETS, nextSection, targetQuestionsFor };
