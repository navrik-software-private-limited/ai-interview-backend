const llmClient = require("../interviewer/llmClient");

// doc/07_INTERVIEW_MODULE_STATUS_AND_ROADMAP.md gap #9: this used to be a
// hardcoded "Phase 2 stub" with no personalization at all. Kept here
// unchanged as the deepest fallback tier below — every caller that used to
// get exactly this string still does, whenever no candidate name or resume/
// JD context is available yet.
const STATIC_GREETING =
  "Hi, welcome to your PractiWiz AI interview. I'm your AI interviewer today. To get started, could you tell me a little about yourself?";

function hasResumeSignal(resumeContext) {
  if (!resumeContext) return false;
  return Boolean(
    (resumeContext.skills && resumeContext.skills.length) ||
      (resumeContext.role_requirements && resumeContext.role_requirements.length) ||
      (resumeContext.knowledge_areas && resumeContext.knowledge_areas.length)
  );
}

// Mirrors question-engine/questionGenerator.js's generateCasePresentation:
// short, natural spoken text (no JSON, no markdown), via
// llmClient.generateReply.
async function generatePersonalizedGreeting({ candidateName, resumeContext, signal }) {
  const systemPrompt = [
    "You are an AI interviewer opening a mock interview session.",
    "Speak a short, warm, natural spoken greeting in 2-3 sentences — no headers, no markdown, no bullet points.",
    candidateName
      ? `Address the candidate by their first name, "${candidateName}".`
      : "No candidate name is available, so greet them without using a name.",
    hasResumeSignal(resumeContext)
      ? `Briefly and naturally acknowledge their background, drawing only from: ${JSON.stringify(
          resumeContext.skills?.length ? resumeContext.skills : resumeContext.role_requirements
        )}. Do not invent details beyond this.`
      : "",
    "End by asking them to tell you a little about themselves to get started.",
  ]
    .filter(Boolean)
    .join(" ");

  const greeting = await llmClient.generateReply([], systemPrompt, { signal });
  return greeting.trim();
}

// doc/07 gap #9: personalizes the greeting using the candidate's name and
// already-extracted resume/JD context when available (jd-resume/contextBuilder.js's
// output, cached onto the session by communication/socketServer.js's
// buildAndCacheResumeContext — which runs fire-and-forget, so it may not have
// finished by the time this is called). Same tiered, never-throws fallback
// philosophy as interviewController.js's speak() and questionGenerator.js's
// generateCasePresentation: LLM personalization first, falling back to a
// name-only template, falling back to the original static stub — a caller
// never has to special-case a failure here.
//
// Returns { text, cacheable } rather than a bare string: only the fully
// static tier is safe to cache (interviewer/interviewController.js's speak()
// caches by text content alone — a personalized greeting must never be
// cached/replayed to a different candidate).
async function buildGreeting({ candidateName, resumeContext, signal } = {}) {
  if (candidateName || hasResumeSignal(resumeContext)) {
    try {
      const text = await generatePersonalizedGreeting({ candidateName, resumeContext, signal });
      if (text) return { text, cacheable: false };
    } catch (err) {
      // doc/real_time_interview_communication_improvement.md Phase 3: a
      // deliberate barge-in cancellation must NOT fall through to a fallback
      // greeting tier and then speak it anyway — the candidate has already
      // moved on. Only a genuine failure falls through.
      if (signal?.aborted) throw err;
    }
  }

  if (candidateName) {
    return {
      text: `Hi ${candidateName}, welcome to your PractiWiz AI interview. I'm your AI interviewer today. To get started, could you tell me a little about yourself?`,
      cacheable: false,
    };
  }

  return { text: STATIC_GREETING, cacheable: true };
}

module.exports = { buildGreeting };
