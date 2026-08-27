const llmClient = require("../interviewer/llmClient");

const BASE_INSTRUCTION = [
  "You are an AI interviewer for PractiWiz, conducting a friendly but professional mock interview.",
  "Ask exactly ONE clear, concise question — no preamble, no numbering, no markdown.",
  "It will be spoken aloud via text-to-speech, so keep it natural and conversational.",
  "Do not repeat a question already covered earlier in the conversation.",
].join(" ");

// doc 04 §2: one section-specific framing fragment per section. CODING/INTRO/
// COMPLETING never reach here (interviewController skips question generation
// for them), so only the four real question-asking sections are covered.
const SECTION_FRAMING = {
  JD_RESUME:
    "Ask about the candidate's background, relevant work experience, and how it connects to the role they're interviewing for.",
  APTITUDE:
    "Ask a reasoning/aptitude-style question suitable for a verbal interview — logical reasoning, problem-solving, or situational judgment. Keep it answerable out loud, not a written puzzle.",
  CASE:
    "Present a business case-style question for the candidate to reason through out loud — market sizing, strategy, prioritization, or a product/business scenario. If real case study content is provided below, question against that specific case, not a generic one.",
  MINDSET:
    "Ask a realistic software-engineering-judgment scenario — ownership, debugging, trade-offs, maintainability, reliability, collaboration, production thinking, or learning/adaptability. Frame it as a concrete situation, not an abstract definition.",
};

// doc 04 §6: folds the jd-resume/contextBuilder.js output into the JD_RESUME
// framing so questions reference the candidate's actual background instead
// of staying fully generic. Absent for every other section, and absent here
// too whenever context build hasn't finished/produced nothing — same generic
// framing as before in that case.
function buildResumeContextFragment(resumeContext) {
  const parts = [];
  if (resumeContext.skills && resumeContext.skills.length) {
    parts.push(`Skills on their resume: ${resumeContext.skills.join(", ")}.`);
  }
  if (resumeContext.experience_claims && resumeContext.experience_claims.length) {
    parts.push(`Specific claims worth probing: ${resumeContext.experience_claims.join("; ")}.`);
  }
  if (resumeContext.role_requirements && resumeContext.role_requirements.length) {
    parts.push(`Target role requirements: ${resumeContext.role_requirements.join(", ")}.`);
  }
  if (resumeContext.question_targets && resumeContext.question_targets.length) {
    parts.push(`Suggested angles: ${resumeContext.question_targets.join("; ")}.`);
  }
  if (!parts.length) return "";
  return ` Personalize the question using this candidate context (don't read it back verbatim, just use it to ask something specific): ${parts.join(" ")}`;
}

// doc 04 §7: unlike JD_RESUME's LLM-structured resumeContext, case content is
// already curated by the case-study team — no extra LLM structuring step,
// just fold the raw (truncated) text into the framing directly.
function buildCaseContextFragment(caseContentText) {
  if (!caseContentText) return "";
  return ` Real case study content to question against (paraphrase naturally, don't read it back verbatim): """${caseContentText}"""`;
}

// extraContext's shape depends on section: the resumeContext object (JD_RESUME)
// or the caseContentText string (CASE). Ignored for every other section.
// doc/real_time_interview_communication_improvement.md Phase 6: extracted so
// both the batch (generateQuestion) and streaming (generateQuestionStream)
// variants below build the exact same prompt.
function buildQuestionSystemPrompt(section, extraContext) {
  const framing = SECTION_FRAMING[section];
  if (!framing) {
    throw new Error(`generateQuestion called for a section with no framing: ${section}`);
  }
  let systemPrompt = `${BASE_INSTRUCTION} ${framing}`;
  if (section === "JD_RESUME" && extraContext) {
    systemPrompt += buildResumeContextFragment(extraContext);
  } else if (section === "CASE" && extraContext) {
    systemPrompt += buildCaseContextFragment(extraContext);
  }
  return systemPrompt;
}

async function generateQuestion(section, history, extraContext = null, { signal } = {}) {
  const systemPrompt = buildQuestionSystemPrompt(section, extraContext);
  const question = await llmClient.generateReply(history, systemPrompt, { signal });
  return question.trim();
}

async function generateQuestionStream(section, history, extraContext = null, { signal } = {}) {
  const systemPrompt = buildQuestionSystemPrompt(section, extraContext);
  return llmClient.generateReplyStream(history, systemPrompt, { signal });
}

// doc 04 §7's case.presented step: a short, natural spoken narration of the
// real case (not the raw labeled text blob) before questioning begins. Only
// called when caseContentText is available — the CASE section transition
// skips straight to questions otherwise (existing generic behavior).
function buildCasePresentationSystemPrompt(caseContentText) {
  return [
    "You are an AI interviewer presenting a business case study to a candidate before questioning them on it.",
    "Narrate the following case content naturally in 3-5 spoken sentences, as if introducing it out loud — no headers, no markdown, no bullet points.",
    "Do not ask a question yet, just set up the scenario.",
    `Case content: """${caseContentText}"""`,
  ].join(" ");
}

async function generateCasePresentation(caseContentText, { signal } = {}) {
  const systemPrompt = buildCasePresentationSystemPrompt(caseContentText);
  const presentation = await llmClient.generateReply([], systemPrompt, { signal });
  return presentation.trim();
}

async function generateCasePresentationStream(caseContentText, { signal } = {}) {
  const systemPrompt = buildCasePresentationSystemPrompt(caseContentText);
  return llmClient.generateReplyStream([], systemPrompt, { signal });
}

// doc 04 §2 follow-ups: probes a specific gap in the candidate's last answer
// rather than repeating/rephrasing the original question.
function buildFollowUpSystemPrompt(reason) {
  return `${BASE_INSTRUCTION} Ask ONE natural follow-up question that specifically probes: ${reason}. Do not repeat the original question.`;
}

async function generateFollowUp(history, reason, { signal } = {}) {
  const systemPrompt = buildFollowUpSystemPrompt(reason);
  const question = await llmClient.generateReply(history, systemPrompt, { signal });
  return question.trim();
}

async function generateFollowUpStream(history, reason, { signal } = {}) {
  const systemPrompt = buildFollowUpSystemPrompt(reason);
  return llmClient.generateReplyStream(history, systemPrompt, { signal });
}

// "Interview Room – Complete Interview Flow & Implementation Requirements.md"
// §5/§11.1: MCQ questions need structured output (options + the correct
// answer), which generateReply's bare-string return can't carry — uses the
// JSON-mode path (llmClient.generateJson) already established elsewhere in
// this codebase (followUpDecider.js, coding/codeEvaluator.js) instead.
const MCQ_FRAMING = {
  JD_RESUME:
    "Ask a multiple-choice question about a technology, tool, or concept the candidate's background/JD suggests they should know.",
  APTITUDE:
    "Ask a multiple-choice aptitude/reasoning question — logical reasoning, numerical reasoning, verbal reasoning, or situational judgment.",
  CASE:
    "Ask a multiple-choice question testing the candidate's understanding of the business case described below.",
  MINDSET:
    "Ask a multiple-choice question about engineering judgment — e.g. how to prioritize or respond in a realistic scenario (production issue, trade-off, debugging approach, collaboration).",
};

// Doc's own §11.1 example, reused verbatim as the MINDSET fallback — a
// candidate must never get stuck with no question if the model call fails.
const FALLBACK_MCQ = {
  JD_RESUME: {
    questionText: "Which of these best describes a RESTful API?",
    options: [
      { key: "A", text: "A stateful protocol requiring persistent connections" },
      { key: "B", text: "An architectural style using stateless HTTP requests and standard verbs" },
      { key: "C", text: "A database query language" },
      { key: "D", text: "A frontend templating engine" },
    ],
    correctOption: "B",
  },
  APTITUDE: {
    questionText: "If a task takes 4 hours with 2 people working at the same rate, how long would it take with 4 people?",
    options: [
      { key: "A", text: "1 hour" },
      { key: "B", text: "2 hours" },
      { key: "C", text: "4 hours" },
      { key: "D", text: "8 hours" },
    ],
    correctOption: "B",
  },
  CASE: {
    questionText: "Based on the case, which factor would most directly affect the proposed solution's success?",
    options: [
      { key: "A", text: "Market timing and customer readiness" },
      { key: "B", text: "The team's preferred meeting schedule" },
      { key: "C", text: "The office's interior design" },
      { key: "D", text: "The company's logo colors" },
    ],
    correctOption: "A",
  },
  MINDSET: {
    questionText: "What would you do if a production issue is reported immediately before a major release?",
    options: [
      { key: "A", text: "Ignore it and continue the release" },
      { key: "B", text: "Immediately stop all development" },
      { key: "C", text: "Assess the impact and prioritize based on severity" },
      { key: "D", text: "Wait for someone else to handle it" },
    ],
    correctOption: "C",
  },
};

function isUsableMcq(result) {
  return (
    result &&
    typeof result.questionText === "string" &&
    result.questionText.trim() &&
    Array.isArray(result.options) &&
    result.options.length >= 2 &&
    result.options.every((o) => o && typeof o.key === "string" && typeof o.text === "string") &&
    typeof result.correctOption === "string" &&
    result.options.some((o) => o.key === result.correctOption)
  );
}

async function generateMcqQuestion(section, history, extraContext = null, { signal } = {}) {
  const framing = MCQ_FRAMING[section] || MCQ_FRAMING.APTITUDE;
  let prompt = `You are an AI interviewer creating ONE multiple-choice question for a mock interview. ${framing}`;
  if (section === "JD_RESUME" && extraContext) prompt += buildResumeContextFragment(extraContext);
  else if (section === "CASE" && extraContext) prompt += buildCaseContextFragment(extraContext);
  prompt += `

Respond with strict JSON only, no other text:
{
  "questionText": string,
  "options": [{"key":"A","text":string},{"key":"B","text":string},{"key":"C","text":string},{"key":"D","text":string}],
  "correctOption": "A" | "B" | "C" | "D"
}
Exactly 4 options, exactly one correct answer, all four plausible (no option that's obviously a joke or trivially wrong), no numbering/markdown inside questionText.`;

  const result = await llmClient.generateJson(prompt, { signal });
  if (!isUsableMcq(result)) {
    return FALLBACK_MCQ[section] || FALLBACK_MCQ.APTITUDE;
  }
  return { questionText: result.questionText.trim(), options: result.options, correctOption: result.correctOption };
}

module.exports = {
  generateQuestion,
  generateQuestionStream,
  generateFollowUp,
  generateFollowUpStream,
  generateCasePresentation,
  generateCasePresentationStream,
  generateMcqQuestion,
};
