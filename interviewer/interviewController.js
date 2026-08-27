const { emitEnvelope } = require("../communication/envelope");
const sessionStore = require("../session/sessionStore");
const sessionRepository = require("../session/sessionRepository");
const candidateRepository = require("../session/candidateRepository");
const turnMetrics = require("./turnMetrics");
const sentenceChunker = require("./sentenceChunker");
const sttStreamClient = require("../speech/sttStreamClient");
const ttsClient = require("../speech/ttsClient");
const ttsCache = require("../speech/ttsCache");
const visemeEstimator = require("../speech/visemeEstimator");
const audioOutbound = require("../webrtc/audioOutbound");
const conversationGate = require("../webrtc/conversationGate");
const { buildGreeting } = require("../question-engine/greeting");
const questionGenerator = require("../question-engine/questionGenerator");
const followUpDecider = require("../question-engine/followUpDecider");
const sectionPlan = require("../question-engine/sectionPlan");
const interactionTypePlan = require("../question-engine/interactionTypePlan");
const codingProblemGenerator = require("../coding/codingProblemGenerator");
const codeEvaluator = require("../coding/codeEvaluator");
const codingSubmissionRepository = require("../coding/codingSubmissionRepository");
const adminConfigRepository = require("../admin/adminConfigRepository");
const evaluationPipeline = require("../evaluation/evaluationPipeline");
const logger = require("../logs/logger");
const env = require("../config/env");

// Sections driven by the utterance -> answer -> follow-up flow below. INTRO
// is the greeting (handled separately), CODING is driven by its own
// submission-based flow (askNextCodingProblem/handleCodingSubmission, not
// handleAnswer — there's no "answer" here, only a code submission),
// COMPLETING just wraps up.
const QUESTION_SECTIONS = new Set(["JD_RESUME", "APTITUDE", "CASE", "MINDSET"]);

// Keeps LLM prompts bounded across a full ~30+ question interview. Full
// history is still persisted to interview_transcripts/session_events either way.
const MAX_HISTORY_MESSAGES = 16;
function recentHistory(history) {
  return history.slice(-MAX_HISTORY_MESSAGES);
}

// Interview Module – Bug, Gap & UI/UX Improvements.md §3: there was zero
// timing/latency logging anywhere in the STT->LLM->TTS chain before this —
// no way to verify a latency fix actually helped, or catch a future
// regression. Wraps one async call and logs how long it took.
async function timed(sessionId, label, fn) {
  const startedAt = Date.now();
  const result = await fn();
  logger.info(`timing sessionId=${sessionId} label=${label} ms=${Date.now() - startedAt}`);
  return result;
}

// Interview Module – Bug, Gap & UI/UX Improvements.md §1: loaded once per
// session (not re-fetched per question) and cached on the Redis session, so
// the whole interview flow uses one consistent structure even if an admin
// activates a different configuration mid-interview. A missing/broken
// active configuration resolves to {sectionOrder: null, sectionTargets: null},
// which sectionPlan.js's override params treat as "use the hardcoded defaults."
async function loadSectionConfig(sessionId) {
  const active = await adminConfigRepository.getActiveConfiguration();
  if (!active || !active.configuration || !Array.isArray(active.configuration.sections)) {
    return { sectionOrder: null, sectionTargets: null, sectionInteraction: null };
  }
  const sections = active.configuration.sections;
  const sectionOrder = ["INTRO", ...sections.map((s) => s.name), "COMPLETING"];
  const sectionTargets = sections.reduce((acc, s) => {
    acc[s.name] = s.targetQuestions;
    return acc;
  }, { INTRO: 0, COMPLETING: 0 });
  // Interview Room MCQ interaction type: only sections that explicitly set
  // interactionType land in this map — everything else falls through to
  // question-engine/interactionTypePlan.js's SECTION_DEFAULTS, same
  // never-breaks-on-missing-field pattern as sectionTargets above.
  const sectionInteraction = sections.reduce((acc, s) => {
    if (s.interactionType) acc[s.name] = { interactionType: s.interactionType, mcqCount: s.mcqCount };
    return acc;
  }, {});
  await sessionStore.touchSession(sessionId, { sectionOrder, sectionTargets, sectionInteraction });
  return { sectionOrder, sectionTargets, sectionInteraction };
}

async function startInterview(io, sessionId) {
  // Half-duplex gate (webrtc/conversationGate.js): held for the entire greeting +
  // first-question chain so the candidate's mic (echo of the AI's own
  // voice, or just ambient noise) can't be misread as speech mid-greeting.
  const { turnId } = conversationGate.setAiBusy(sessionId);
  try {
    const { sectionOrder } = await loadSectionConfig(sessionId);
    await emitEnvelope(io, sessionId, "interview.started", {});
    // doc/07 gap #9: personalized when a candidate name and/or resume/JD
    // context is available, falls back to the original static greeting
    // otherwise — see question-engine/greeting.js for the tiering.
    const session = await sessionStore.getSession(sessionId);
    const candidateName = await candidateRepository.fetchCandidateName(session && session.candidateId);
    const resumeContext = (session && session.resumeContext) || null;
    const greeting = await buildGreeting({ candidateName, resumeContext, signal: conversationGate.getSignal(sessionId) });
    await speak(io, sessionId, greeting.text, { cacheable: greeting.cacheable });
    const firstSection = sectionOrder ? sectionOrder[1] : "JD_RESUME"; // index 0 is INTRO
    await transitionToSection(io, sessionId, firstSection || "JD_RESUME");
  } catch (err) {
    if (!conversationGate.isCurrentTurn(sessionId, turnId)) {
      logger.info(`startInterview superseded by a newer turn sessionId=${sessionId}`);
    } else {
      throw err;
    }
  } finally {
    conversationGate.releaseAiBusy(sessionId, turnId);
  }
}

async function onCandidateUtterance(io, sessionId, pcmBuffer, sampleRate) {
  // Held for the whole STT -> decide -> speak chain below, not just the
  // speak() call — this is also what stops a second utterance detected
  // mid-processing from triggering an overlapping reply.
  const { turnId } = conversationGate.setAiBusy(sessionId);
  try {
    // doc/real_time_interview_communication_improvement.md Phase 8: this
    // used to say "ai.listening" here — but the candidate has just *finished*
    // speaking and the backend is now busy transcribing/deciding, the exact
    // opposite of "listening." ai.thinking is the honest label for this
    // moment; the real "genuinely ready for your voice" moment is emitted
    // from askNextQuestion/askFollowUp below, once a question is actually
    // waiting on a spoken answer.
    await emitEnvelope(io, sessionId, "ai.thinking", {});
    turnMetrics.mark(sessionId, "sttStart");
    const text = await timed(sessionId, "stt", () => sttStreamClient.finishTranscription(sessionId, pcmBuffer, sampleRate));
    turnMetrics.mark(sessionId, "sttEnd");
    if (!text || !text.trim()) return;

    await emitEnvelope(io, sessionId, "transcript.final", { speaker: "candidate", text });
    sessionRepository.insertTranscriptRow(sessionId, "candidate", text);
    await sessionStore.appendHistory(sessionId, { role: "user", content: text });

    await handleAnswer(io, sessionId, text);
  } catch (err) {
    // doc/real_time_interview_communication_improvement.md Phase 3: a
    // barge-in on the AI's *next* reply (while this utterance's STT/decision
    // chain is still in flight) surfaces here as an AbortError once the
    // now-superseded turnId's releaseAiBusy below is a no-op anyway — not a
    // real failure, just noisier to log as one.
    if (!conversationGate.isCurrentTurn(sessionId, turnId)) {
      logger.info(`onCandidateUtterance superseded by a newer turn sessionId=${sessionId}`);
    } else {
      logger.error(`onCandidateUtterance failed sessionId=${sessionId}:`, err.message);
      // doc/real_time_interview_communication_improvement.md Phase 9: the
      // candidate's answer was never successfully processed (STT and/or the
      // decision/generation chain genuinely failed, every fallback tier
      // exhausted) — say so and re-open listening rather than leaving the
      // frontend stuck on ai.thinking with the answer silently dropped.
      await speakRecovery(io, sessionId, { expectAnswer: true });
    }
  } finally {
    conversationGate.releaseAiBusy(sessionId, turnId);
  }
}

// doc 04 §2 core decision point: was this answer to a follow-up (thread
// concludes either way) or to a fresh primary question (may spawn exactly
// one follow-up)?
async function handleAnswer(io, sessionId, answerText) {
  const session = await sessionStore.getSession(sessionId);
  if (!session || !QUESTION_SECTIONS.has(session.currentSection)) return;
  // 03-LIVE-INTERVIEW-MODULE.md §8 gate: while the case presentation is
  // playing/awaiting acknowledgement, no question has been asked yet for
  // this section — anything the candidate says here isn't an answer.
  if (session.currentSection === "CASE" && session.awaitingCaseAcknowledgement) return;

  // ai.thinking: covers the LLM decision-making window between the
  // candidate's transcript.final and whatever comes next (follow-up decision
  // + question/follow-up generation) — superseded by the next ai.speaking
  // (via speak()) or ai.listening emission.
  await emitEnvelope(io, sessionId, "ai.thinking", {});

  sessionRepository.markQuestionAskedCompleted(session.currentQuestionAskedId);

  if (session.currentQuestionIsFollowUp) {
    await emitEnvelope(io, sessionId, "followup.completed", {
      section: session.currentSection,
      questionId: session.currentQuestionAskedId,
    });
    await advanceOrAskNext(io, sessionId);
    return;
  }

  await emitEnvelope(io, sessionId, "question.completed", {
    section: session.currentSection,
    questionId: session.currentQuestionAskedId,
  });

  turnMetrics.mark(sessionId, "followupDecisionStart");
  const decision = await timed(sessionId, "followup-decision", () =>
    followUpDecider.shouldFollowUp(session.currentQuestionText, answerText, {
      signal: conversationGate.getSignal(sessionId),
    })
  );
  turnMetrics.mark(sessionId, "followupDecisionEnd");
  if (decision.followUp) {
    await askFollowUp(io, sessionId, session, decision.reason);
  } else {
    await advanceOrAskNext(io, sessionId);
  }
}

// Interview Module – Bug, Gap & UI/UX Improvements.md §2: candidate-facing
// "skip question" control — bypasses the answer/follow-up flow entirely and
// just advances, same as an answer that generated no follow-up. No
// evaluation signal is recorded for a skipped question.
async function handleSkip(io, sessionId) {
  const session = await sessionStore.getSession(sessionId);
  if (!session) return;

  const { turnId } = conversationGate.setAiBusy(sessionId);
  try {
    if (session.currentSection === "CODING") {
      if (!session.currentCodingProblem) return;
      await emitEnvelope(io, sessionId, "question.skipped", {
        section: "CODING",
        problemId: session.currentCodingProblem.problemId,
      });
      await sessionStore.touchSession(sessionId, { currentCodingProblem: null });
      await advanceCoding(io, sessionId);
      return;
    }

    if (!QUESTION_SECTIONS.has(session.currentSection)) return;
    // Same gate as handleAnswer: nothing to skip while the case is still
    // being presented — no question has been asked yet.
    if (session.currentSection === "CASE" && session.awaitingCaseAcknowledgement) return;

    await emitEnvelope(io, sessionId, "question.skipped", {
      section: session.currentSection,
      questionId: session.currentQuestionAskedId,
    });
    sessionRepository.markQuestionAskedCompleted(session.currentQuestionAskedId);
    await advanceOrAskNext(io, sessionId);
  } catch (err) {
    // doc/real_time_interview_communication_improvement.md Phase 9: same
    // last-resort recovery as onCandidateUtterance — advanceOrAskNext's
    // generation chain can genuinely fail after every fallback tier is
    // exhausted, and this function previously had no catch at all, leaving
    // the frontend stuck with no signal.
    if (!conversationGate.isCurrentTurn(sessionId, turnId)) {
      logger.info(`handleSkip superseded by a newer turn sessionId=${sessionId}`);
    } else {
      logger.error(`handleSkip failed sessionId=${sessionId}:`, err.message);
      await speakRecovery(io, sessionId);
    }
  } finally {
    conversationGate.releaseAiBusy(sessionId, turnId);
  }
}

// Interview Module – Bug, Gap & UI/UX Improvements.md §2: skips every
// remaining question in the current section and moves straight to the next
// one. Unlike handleSkip, this is allowed even mid-CASE-presentation (the
// candidate is skipping the whole section, gate included, not answering a
// question) and unconditionally on CODING (no "already submitted" guard —
// there's nothing left to submit once the section itself is skipped).
// section.skipped is auto-persisted to interview_session_events by
// emitEnvelope — that's the "recorded appropriately... report should
// indicate" requirement, for the future Report module to read.
async function handleSkipSection(io, sessionId) {
  const session = await sessionStore.getSession(sessionId);
  if (!session) return;

  const section = session.currentSection;
  if (!section || section === "COMPLETING") return;

  const { turnId } = conversationGate.setAiBusy(sessionId);
  try {
    await emitEnvelope(io, sessionId, "section.skipped", {
      section,
      questionsAskedBeforeSkip: session.questionsAskedInSection,
    });

    if (section === "CASE" && session.awaitingCaseAcknowledgement) {
      await sessionStore.touchSession(sessionId, { awaitingCaseAcknowledgement: false });
    }
    if (section === "CODING") {
      await sessionStore.touchSession(sessionId, { currentCodingProblem: null });
    }

    const next = sectionPlan.nextSection(section, session.sectionOrder);
    await transitionToSection(io, sessionId, next);
  } catch (err) {
    // doc/real_time_interview_communication_improvement.md Phase 9: see
    // handleSkip's identical comment above — transitionToSection's
    // generation chain (new section's question/case presentation) can
    // genuinely fail after every fallback tier is exhausted.
    if (!conversationGate.isCurrentTurn(sessionId, turnId)) {
      logger.info(`handleSkipSection superseded by a newer turn sessionId=${sessionId}`);
    } else {
      logger.error(`handleSkipSection failed sessionId=${sessionId}:`, err.message);
      await speakRecovery(io, sessionId);
    }
  } finally {
    conversationGate.releaseAiBusy(sessionId, turnId);
  }
}

// Requested UX fix (2026-08-26): the candidate should see the follow-up
// text on screen BEFORE the AI starts speaking it, not after. Phase 6's
// speak-first-persist-after order (streaming LLM->TTS together) can't
// guarantee that — the full text is only known once speaking is basically
// done. Reverted to persist-then-speak (same shape askNextQuestion's MCQ
// branch already uses): generate the full text first, persist + emit
// followup.started (text visible immediately), THEN speak it. speak() still
// uses TTS streaming internally for fast time-to-first-audio — only the
// LLM-streaming-while-speaking overlap is dropped for this call site.
// speakGenerated()/generateFollowUpStream() are left in place, untouched,
// just no longer called here.
async function askFollowUp(io, sessionId, session, reason) {
  const history = recentHistory(await sessionStore.getHistory(sessionId));
  const signal = conversationGate.getSignal(sessionId);

  turnMetrics.mark(sessionId, "generationStart");
  const followUpText = await timed(sessionId, "followup-generation", () =>
    questionGenerator.generateFollowUp(history, reason, { signal })
  );
  turnMetrics.mark(sessionId, "generationEnd");

  const followUpId = await sessionRepository.insertQuestionAskedRow(
    sessionId,
    session.currentSection,
    session.questionsAskedInSection,
    true,
    session.currentQuestionAskedId,
    followUpText
  );

  await sessionStore.touchSession(sessionId, {
    currentQuestionAskedId: followUpId,
    currentQuestionIsFollowUp: true,
  });
  await sessionRepository.updateSessionSection(sessionId, session.currentSection, followUpId);

  // text is new here — followup.started previously carried no text field at
  // all, so the frontend had to wait for the later transcript.final to
  // back-fill it (see interviewEngineRoomSlice.js). Emitted before speak()
  // so the candidate sees it first.
  await emitEnvelope(io, sessionId, "followup.started", {
    section: session.currentSection,
    questionId: followUpId,
    parentQuestionId: session.currentQuestionAskedId,
    reason,
    text: followUpText,
  });

  await speak(io, sessionId, followUpText);

  // doc/real_time_interview_communication_improvement.md Phase 8: the
  // follow-up has now actually been spoken and the backend is genuinely
  // waiting on a voice answer — this is the real "Listening..." moment.
  await emitEnvelope(io, sessionId, "ai.listening", {});
}

// After a primary question's thread fully concludes (no follow-up, or the
// follow-up was just answered): either ask the next question in this
// section, or move on if the section's target question count is reached.
async function advanceOrAskNext(io, sessionId) {
  const session = await sessionStore.getSession(sessionId);
  if (!session) return;

  const target = sectionPlan.targetQuestionsFor(session.currentSection, session.sectionTargets);
  if (session.questionsAskedInSection >= target) {
    if (session.currentSection === "CASE") {
      await emitEnvelope(io, sessionId, "case.completed", {
        questionsAsked: session.questionsAskedInSection,
      });
    }
    await emitEnvelope(io, sessionId, "interview.section.completed", {
      section: session.currentSection,
      questionsAsked: session.questionsAskedInSection,
    });
    const next = sectionPlan.nextSection(session.currentSection, session.sectionOrder);
    await transitionToSection(io, sessionId, next);
  } else {
    await askNextQuestion(io, sessionId, session.currentSection);
  }
}

async function askNextQuestion(io, sessionId, section) {
  const session = await sessionStore.getSession(sessionId);
  // 03-LIVE-INTERVIEW-MODULE.md §8's "structurally impossible" requirement:
  // this is the single choke point every path to a CASE question passes
  // through (caseFlowController.acknowledgeCase included), so the gate is
  // enforced here regardless of caller.
  if (section === "CASE" && session && session.awaitingCaseAcknowledgement) {
    logger.warn(`askNextQuestion(CASE) blocked — awaiting case.acknowledged sessionId=${sessionId}`);
    return;
  }
  const history = recentHistory((session && session.conversationHistory) || []);
  // doc 04 §6/§7: JD_RESUME personalizes off resumeContext, CASE grounds off
  // caseContentText — both populated asynchronously by socketServer.js's
  // buildAndCacheResumeContext, so either may still be null here (falls back
  // to generic framing in that case).
  let extraContext = null;
  if (section === "JD_RESUME") {
    extraContext = (session && session.resumeContext) || null;
  } else if (section === "CASE") {
    extraContext = (session && session.caseContentText) || null;
  }

  const indexInSection = (session && session.questionsAskedInSection) || 0;
  const sequence = indexInSection + 1;
  const target = sectionPlan.targetQuestionsFor(section, session && session.sectionTargets);
  // "Interview Room – Complete Interview Flow & Implementation
  // Requirements.md" §13/§14: which interaction type this specific question
  // (not the whole section) should use — CASE/MINDSET can mix MCQ and voice
  // within themselves, so this is decided per-question, not per-section.
  const interactionType = interactionTypePlan.interactionTypeForQuestion(
    section,
    indexInSection,
    target,
    session && session.sectionInteraction
  );

  if (interactionType === "MCQ") {
    turnMetrics.mark(sessionId, "generationStart");
    const mcq = await timed(sessionId, "mcq-generation", () =>
      questionGenerator.generateMcqQuestion(section, history, extraContext, {
        signal: conversationGate.getSignal(sessionId),
      })
    );
    turnMetrics.mark(sessionId, "generationEnd");

    const questionId = await sessionRepository.insertQuestionAskedRow(
      sessionId,
      section,
      sequence,
      false,
      null,
      mcq.questionText,
      { interactionType: "MCQ", options: mcq.options, correctOption: mcq.correctOption }
    );

    await sessionStore.touchSession(sessionId, {
      questionsAskedInSection: sequence,
      currentQuestionAskedId: questionId,
      currentQuestionIsFollowUp: false,
      currentQuestionText: mcq.questionText,
    });
    await sessionRepository.updateSessionSection(sessionId, section, questionId);

    // options are shown in the UI — never included in what's spoken;
    // reading four options aloud one after another is bad audio UX and the
    // doc's own §5 only asks for the question stem to be spoken.
    await emitEnvelope(io, sessionId, "question.started", {
      section,
      questionId,
      sequence,
      text: mcq.questionText,
      interactionType: "MCQ",
      options: mcq.options, // never correctOption — must not leak the answer to the client
    });

    await speak(io, sessionId, mcq.questionText);
    return;
  }

  // Requested UX fix (2026-08-26): same persist-then-speak restoration as
  // askFollowUp — see that function's comment for why. Same shape the MCQ
  // branch just above already uses: generate the full text first, persist +
  // emit question.started (text visible immediately), THEN speak it.
  const signal = conversationGate.getSignal(sessionId);
  turnMetrics.mark(sessionId, "generationStart");
  const questionText = await timed(sessionId, "question-generation", () =>
    questionGenerator.generateQuestion(section, history, extraContext, { signal })
  );
  turnMetrics.mark(sessionId, "generationEnd");

  const questionId = await sessionRepository.insertQuestionAskedRow(
    sessionId,
    section,
    sequence,
    false,
    null,
    questionText
  );

  await sessionStore.touchSession(sessionId, {
    questionsAskedInSection: sequence,
    currentQuestionAskedId: questionId,
    currentQuestionIsFollowUp: false,
    currentQuestionText: questionText,
  });
  await sessionRepository.updateSessionSection(sessionId, section, questionId);

  await emitEnvelope(io, sessionId, "question.started", {
    section,
    questionId,
    sequence,
    text: questionText,
    interactionType: "VOICE_QA",
  });

  await speak(io, sessionId, questionText);

  // doc/real_time_interview_communication_improvement.md Phase 8: the
  // question has now actually been spoken and the backend is genuinely
  // waiting on a voice answer — this is the real "Listening..." moment. Not
  // emitted for MCQ (that branch returns before reaching here) — a click,
  // not a voice answer, is expected.
  await emitEnvelope(io, sessionId, "ai.listening", {});
}

// "Interview Room – Complete Interview Flow & Implementation
// Requirements.md" §5/§12: MCQ's answer path — parallel to
// handleCodingSubmission (conversationGate-wrapped, not routed through handleAnswer,
// since there's no STT/utterance involved), not handleAnswer. Deliberately
// does not reveal correctness to the client in real time (a real interviewer
// doesn't flash "wrong!" mid-interview) — correctness is scored later by
// evaluation/questionEvaluator.js from the persisted correct_option.
// Follow-ups never apply to a discrete-choice answer, so this skips
// followUpDecider entirely and advances straight on.
async function handleMcqSubmission(io, sessionId, { questionAskedId, selectedOption } = {}) {
  const session = await sessionStore.getSession(sessionId);
  if (!session || !QUESTION_SECTIONS.has(session.currentSection)) {
    logger.warn(`mcq.submit received outside a question section sessionId=${sessionId}`);
    return;
  }
  if (!questionAskedId || questionAskedId !== session.currentQuestionAskedId) {
    logger.warn(`mcq.submit questionAskedId mismatch sessionId=${sessionId} received=${questionAskedId}`);
    return;
  }
  if (!selectedOption) {
    logger.warn(`mcq.submit received with no selectedOption sessionId=${sessionId}`);
    return;
  }

  const { turnId } = conversationGate.setAiBusy(sessionId);
  try {
    await sessionRepository.recordMcqAnswer(questionAskedId, selectedOption);
    await sessionStore.appendHistory(sessionId, {
      role: "user",
      content: `[Selected option ${selectedOption} for: "${session.currentQuestionText}"]`,
    });

    await emitEnvelope(io, sessionId, "question.completed", {
      section: session.currentSection,
      questionId: questionAskedId,
    });

    await advanceOrAskNext(io, sessionId);
  } catch (err) {
    // doc/real_time_interview_communication_improvement.md Phase 9: see
    // handleSkip's identical comment above.
    if (!conversationGate.isCurrentTurn(sessionId, turnId)) {
      logger.info(`handleMcqSubmission superseded by a newer turn sessionId=${sessionId}`);
    } else {
      logger.error(`handleMcqSubmission failed sessionId=${sessionId}:`, err.message);
      await speakRecovery(io, sessionId);
    }
  } finally {
    conversationGate.releaseAiBusy(sessionId, turnId);
  }
}

// 03-LIVE-INTERVIEW-MODULE.md §9: generates + presents the next coding
// problem. Parallel to askNextQuestion, but CODING isn't in QUESTION_SECTIONS
// — it's driven by coding.submit (handleCodingSubmission below), not by a
// transcribed voice answer.
async function askNextCodingProblem(io, sessionId) {
  const session = await sessionStore.getSession(sessionId);
  const previousTitles = (session && session.codingProblemTitles) || [];
  const sequence = ((session && session.questionsAskedInSection) || 0) + 1;

  const problem = await codingProblemGenerator.generateProblem(previousTitles);

  await sessionStore.touchSession(sessionId, {
    questionsAskedInSection: sequence,
    currentCodingProblem: problem,
    codingProblemTitles: [...previousTitles, problem.title],
  });
  await sessionRepository.updateSessionSection(sessionId, "CODING", null);

  await emitEnvelope(io, sessionId, "coding.started", {
    problemId: problem.problemId,
    sequence,
    title: problem.title,
    statement: problem.statement,
    examples: problem.examples || [],
    constraints: problem.constraints || [],
  });

  await speak(
    io,
    sessionId,
    `Here's your next problem: ${problem.title}. Take a look at the problem statement, write your solution, and submit when you're ready.`
  );
}

// Mirrors advanceOrAskNext's target-check/advance logic for the CODING
// section specifically — kept separate rather than folded into
// advanceOrAskNext since CODING's completion trigger (a code submission) and
// question-tracking shape differ enough from the voice Q&A sections to make
// sharing one function more confusing than two small parallel ones.
async function advanceCoding(io, sessionId) {
  const session = await sessionStore.getSession(sessionId);
  if (!session) return;

  const target = sectionPlan.targetQuestionsFor("CODING", session.sectionTargets);
  if (session.questionsAskedInSection >= target) {
    await emitEnvelope(io, sessionId, "interview.section.completed", {
      section: "CODING",
      questionsAsked: session.questionsAskedInSection,
    });
    const next = sectionPlan.nextSection("CODING", session.sectionOrder);
    await transitionToSection(io, sessionId, next);
  } else {
    await askNextCodingProblem(io, sessionId);
  }
}

// 03-LIVE-INTERVIEW-MODULE.md §9: triggered by the candidate's coding.submit
// envelope (see communication/socketServer.js). Evaluates via LLM (no
// sandbox — coding/codeEvaluator.js), persists, emits the doc's
// coding.submitted confirmation, optionally asks the candidate to explain
// their approach (spoken; their reply is still captured into the transcript
// by the always-on STT pipeline, just not structurally tracked as a
// follow-up the way QUESTION_SECTIONS answers are — see plan notes), then advances.
async function handleCodingSubmission(io, sessionId, { code, language } = {}) {
  const session = await sessionStore.getSession(sessionId);
  if (!session || session.currentSection !== "CODING" || !session.currentCodingProblem) {
    logger.warn(`coding.submit received with no active coding problem sessionId=${sessionId}`);
    return;
  }
  if (!code || !code.trim()) {
    logger.warn(`coding.submit received with empty code sessionId=${sessionId}`);
    return;
  }

  const { turnId } = conversationGate.setAiBusy(sessionId);
  try {
    const problem = session.currentCodingProblem;
    const evaluation = await codeEvaluator.evaluateSubmission({
      statement: problem.statement,
      code,
      language,
    });

    codingSubmissionRepository.insertCodingSubmission(sessionId, {
      sequence: session.questionsAskedInSection,
      statement: problem.statement,
      language,
      code,
      evaluation,
    }); // fire-and-forget

    await sessionStore.touchSession(sessionId, { currentCodingProblem: null });
    await sessionStore.appendHistory(sessionId, {
      role: "user",
      content: `[Submitted code for "${problem.title}"]\n${code}`,
    });

    await emitEnvelope(io, sessionId, "coding.submitted", {
      problemId: problem.problemId,
      sequence: session.questionsAskedInSection,
      evaluation,
    });

    if (evaluation && evaluation.explanation_needed) {
      await speak(io, sessionId, evaluation.explanation_needed);
    }

    await advanceCoding(io, sessionId);
  } catch (err) {
    // doc/real_time_interview_communication_improvement.md Phase 9: see
    // handleSkip's identical comment above.
    if (!conversationGate.isCurrentTurn(sessionId, turnId)) {
      logger.info(`handleCodingSubmission superseded by a newer turn sessionId=${sessionId}`);
    } else {
      logger.error(`handleCodingSubmission failed sessionId=${sessionId}:`, err.message);
      await speakRecovery(io, sessionId);
    }
  } finally {
    conversationGate.releaseAiBusy(sessionId, turnId);
  }
}

// Enters a new section. CASE and CODING each have their own entry flow
// (case presentation gate / first coding problem); COMPLETING wraps up; the
// remaining sections ask their first question directly.
async function transitionToSection(io, sessionId, section) {
  if (!section) {
    await endSession(io, sessionId, "interview_completed");
    return;
  }

  await sessionStore.touchSession(sessionId, { currentSection: section, questionsAskedInSection: 0 });
  await sessionRepository.updateSessionSection(sessionId, section, null);
  await emitEnvelope(io, sessionId, "interview.section.started", { section });
  // 03-LIVE-INTERVIEW-MODULE.md §3 Master Event Registry: a session-level
  // state summary, distinct from the section-scoped events above. Always
  // ACTIVE here — the COMPLETING/COMPLETED transitions are emitted
  // authoritatively from endSession() below, right alongside their DB writes.
  await emitEnvelope(io, sessionId, "interview.state", { status: "ACTIVE", current_section: section });

  if (section === "CODING") {
    // 03-LIVE-INTERVIEW-MODULE.md §9: no sandboxed execution — see
    // coding/codeEvaluator.js for the documented LLM-judged, not
    // execution-verified, scope boundary.
    await speak(
      io,
      sessionId,
      "Now let's move to a short coding exercise. I'll describe a problem, and you can write your solution in the code editor.",
      { cacheable: true }
    );
    await askNextCodingProblem(io, sessionId);
    return;
  }

  if (section === "CASE") {
    // 03-LIVE-INTERVIEW-MODULE.md §8: case.started -> case.presented, which
    // sets the awaitingCaseAcknowledgement gate. No question is asked here —
    // caseFlowController.acknowledgeCase() is the only path into the CASE
    // question loop, triggered by the candidate's explicit case.acknowledged.
    await emitEnvelope(io, sessionId, "case.started", {});
    const session = await sessionStore.getSession(sessionId);
    const caseContentText = session && session.caseContentText;
    // Requested UX fix (2026-08-26): the AI no longer narrates the case
    // content itself — the candidate reads it on screen via the existing
    // CasePresentation.js reading panel (driven by case.presented's own
    // `content` field below, unaffected by this). This is now the same
    // short static line unconditionally, whether or not caseContentText is
    // available yet (previously only the "not available yet" fallback used
    // this line) — no LLM call needed at all any more.
    // doc/real_time_interview_communication_improvement.md Phase 6's
    // generateCasePresentation(Stream) are left in place, just no longer
    // called from here.
    const presentation =
      "This is the case study section. Please take a moment to read the case study on your screen, and when you're ready, we'll begin the questions on it.";
    await speak(io, sessionId, presentation, { cacheable: true });
    // Lazy require to avoid a circular require (caseFlowController lazily
    // requires this module back, to call askNextQuestion on acknowledgement).
    const caseFlowController = require("../case-study/caseFlowController");
    await caseFlowController.presentCase(io, sessionId, caseContentText, presentation);
    return;
  }

  if (section === "COMPLETING") {
    await speak(
      io,
      sessionId,
      "That wraps up our interview. Thank you for your thoughtful answers today — this has been a great conversation.",
      { cacheable: true }
    );
    // doc 03 §14 distinguishes "content is done" (interview.completed) from
    // "the connection/session lifecycle has ended" (session.completed,
    // emitted later inside endSession) — two different timeline moments a
    // future Report module will want to tell apart.
    await emitEnvelope(io, sessionId, "interview.completed", {});
    await endSession(io, sessionId, "interview_completed");
    return;
  }

  await askNextQuestion(io, sessionId, section);
}

// Interview Module – Bug, Gap & UI/UX Improvements.md §3: the buffered
// (non-streaming) TTS call was the main source of "delay before the
// interviewer starts speaking" — it awaited ElevenLabs' entire response
// before playback could start at all. Now streamed: playback of each ~100ms
// chunk begins as it arrives (speech/ttsClient.js's synthesizeSpeechStreaming),
// instead of waiting for the full response. `cacheable: true` is for the
// handful of fully-static phrases (greeting, fixed transition/completion
// lines) — those skip the network round trip entirely on every call after
// the first (speech/ttsCache.js).
// doc/real_time_interview_communication_improvement.md Phase 6/7: the
// tiered TTS fallback (cache/stream -> plain non-streaming -> silence) that
// used to live inline in speak() below, extracted so speakGenerated() can
// reuse it per-sentence without also re-running the once-per-response
// envelope/transcript/turnMetrics.finish lifecycle. Same behavior as
// before: a genuine TTS failure never throws (cascades to silence instead);
// a deliberate barge-in cancellation (signal.aborted) does throw, and is
// NOT retried through the remaining tiers — the candidate has already
// moved on to a new turn. onFirstAudio (optional) fires exactly once, at
// the earliest moment any audio for THIS text is about to play — callers
// use it to mark ttsFirstAudio/playbackStart themselves, since for a
// multi-sentence response only the very first sentence's "first audio"
// should count, not each sentence's.
async function synthesizeAndPlay(sessionId, text, { cacheable = false, signal, turnId, onFirstAudio } = {}) {
  const startedAt = Date.now();
  let pcm;
  let firstChunkMs;

  function markFirstAudio() {
    if (firstChunkMs === undefined) firstChunkMs = Date.now() - startedAt;
    if (onFirstAudio) onFirstAudio();
  }

  try {
    if (cacheable) {
      pcm = await ttsCache.getOrSynthesize(text, { signal });
      markFirstAudio();
      await audioOutbound.playPcmBuffer(sessionId, pcm, turnId);
    } else {
      let lastPlayback = Promise.resolve();
      pcm = await ttsClient.synthesizeSpeechStreaming(
        text,
        (chunk) => {
          markFirstAudio();
          lastPlayback = audioOutbound.playPcmBuffer(sessionId, chunk, turnId);
        },
        { signal }
      );
      await lastPlayback;
    }
  } catch (err) {
    if (signal?.aborted) {
      logger.info(`synthesizeAndPlay cancelled by barge-in sessionId=${sessionId}`);
      throw err;
    }
    logger.warn(`TTS (${cacheable ? "cached" : "streaming"}) failed sessionId=${sessionId}, falling back to non-streaming:`, err.message);
    try {
      pcm = await ttsClient.synthesizeSpeech(text, { signal });
      markFirstAudio();
      await audioOutbound.playPcmBuffer(sessionId, pcm, turnId);
    } catch (fallbackErr) {
      if (signal?.aborted) {
        logger.info(`synthesizeAndPlay cancelled by barge-in sessionId=${sessionId}`);
        throw fallbackErr;
      }
      logger.error(`TTS fully failed sessionId=${sessionId}, continuing with silence:`, fallbackErr.message);
      pcm = ttsClient.silentPcmBuffer(ttsClient.SILENCE_FALLBACK_MS);
      markFirstAudio();
      await audioOutbound.playPcmBuffer(sessionId, pcm, turnId);
    }
  }

  return { pcm, firstChunkMs, totalMs: Date.now() - startedAt };
}

// Thin wrapper around synthesizeAndPlay for a single already-known piece of
// text — everything that's specific to "this is one whole AI turn" (the
// surrounding envelopes, transcript, history, visemes, turnMetrics.finish)
// lives here, not in synthesizeAndPlay itself. External behavior is
// unchanged from before this extraction: a genuine TTS failure still never
// throws; a deliberate abort still does (synthesizeAndPlay's throw
// propagates straight out, same as before).
async function speak(io, sessionId, text, { cacheable = false } = {}) {
  // doc/real_time_interview_communication_improvement.md Phase 3: captured
  // once, here — never re-read from conversationGate later. By the time a
  // catch/callback below runs, a barge-in may already have moved the
  // session on to a newer turn with its own fresh, non-aborted signal; only
  // this original reference correctly reflects whether THIS call got cancelled.
  const signal = conversationGate.getSignal(sessionId);
  const turnId = conversationGate.getTurnId(sessionId);
  turnMetrics.mark(sessionId, "ttsStart");
  await emitEnvelope(io, sessionId, "ai.response.started", {});
  await emitEnvelope(io, sessionId, "ai.speaking", {});

  const { pcm, firstChunkMs, totalMs } = await synthesizeAndPlay(sessionId, text, {
    cacheable,
    signal,
    turnId,
    onFirstAudio: () => {
      turnMetrics.mark(sessionId, "ttsFirstAudio");
      turnMetrics.mark(sessionId, "playbackStart");
    },
  });
  turnMetrics.mark(sessionId, "playbackEnd");

  logger.info(`timing sessionId=${sessionId} label=tts firstChunkMs=${firstChunkMs} totalMs=${totalMs} cached=${cacheable}`);
  turnMetrics.finish(sessionId);

  await emitEnvelope(io, sessionId, "transcript.final", { speaker: "ai", text });
  sessionRepository.insertTranscriptRow(sessionId, "ai", text);
  await sessionStore.appendHistory(sessionId, { role: "assistant", content: text });

  // ai.visemes: amplitude-envelope fallback (speech/visemeEstimator.js) —
  // ElevenLabs has no native viseme/phoneme timing. Emitted once the full
  // buffer is assembled — now that playback starts on the first chunk
  // instead of after the whole response, this lands close to when audio is
  // already playing rather than strictly before it. Documented tradeoff:
  // avatar lip-sync starts a beat after audio instead of frame-perfect from
  // the start; time-to-first-audio was the bigger, doc-requested win, and
  // viseme sync was already a 100ms-bucket approximation, not sample-accurate.
  const envelope = visemeEstimator.estimateEnvelope(pcm);
  await emitEnvelope(io, sessionId, "ai.visemes", envelope);

  await emitEnvelope(io, sessionId, "ai.response.completed", {});
}

// doc/real_time_interview_communication_improvement.md Phase 9 (§19: "do not
// leave the interviewer stuck in AI_THINKING" / STT failure "do not lose
// session, allow retry"). Last-resort recovery for the five candidate-
// triggered entry points below (onCandidateUtterance, handleSkip,
// handleSkipSection, handleMcqSubmission, handleCodingSubmission): each
// already runs through several fallback tiers before anything reaches here
// (sttStreamClient's realtime->batch, synthesizeAndPlay's stream->plain->
// silence, speakGenerated's stream->batch) — this only fires once ALL of
// those have also genuinely failed. Speaking something (rather than just
// logging) is what actually unsticks the frontend: speak()'s own
// ai.response.started/ai.speaking/ai.response.completed sequence moves
// aiState out of whatever it was stuck in, with no new envelope type needed.
// Never retries the failed operation itself — several callers have already
// run non-idempotent side effects (transcript rows, history appends) before
// the point of failure, so re-running the whole handler risks duplicates;
// the existing fallback tiers are the retry layer, this is just "don't go
// silent when even those are exhausted." Must never throw itself (wrapped in
// its own try/catch) — a secondary failure here must not prevent the
// caller's own finally { conversationGate.releaseAiBusy(...) } from running.
const RECOVERY_MESSAGE = "Sorry, I ran into a brief technical issue there. Let's continue.";
async function speakRecovery(io, sessionId, { expectAnswer = false } = {}) {
  try {
    await speak(io, sessionId, RECOVERY_MESSAGE, { cacheable: true });
    // Only onCandidateUtterance passes expectAnswer: true — that's the one
    // context where the candidate's prior answer genuinely was never
    // processed and they're expected to speak again. The other four entry
    // points have no pending question at the point of failure, so they
    // leave listening unclaimed rather than falsely implying one.
    if (expectAnswer) await emitEnvelope(io, sessionId, "ai.listening", {});
  } catch (err) {
    logger.error(`speakRecovery itself failed sessionId=${sessionId}:`, err.message);
  }
}

// doc/real_time_interview_communication_improvement.md Phases 6+7: streams
// an LLM reply sentence-by-sentence, synthesizing+playing (Phase 7's
// pipelined "TTS queue") each sentence as soon as it's chunked rather than
// waiting for the whole reply — "first meaningful sentence -> TTS starts ->
// remaining LLM response continues," not "wait for the entire response."
// streamFn(): () => Promise<AsyncIterable<{content: string}>> — an
// llmClient.generateReplyStream call already bound with history/systemPrompt/
// signal, matching timed()'s "caller provides a thunk" style. fallbackFn():
// () => Promise<string> — the plain batch generateX equivalent, used only if
// the stream itself genuinely fails (not on a barge-in abort).
async function speakGenerated(io, sessionId, streamFn, fallbackFn) {
  const signal = conversationGate.getSignal(sessionId);
  const turnId = conversationGate.getTurnId(sessionId);
  turnMetrics.mark(sessionId, "ttsStart");
  await emitEnvelope(io, sessionId, "ai.response.started", {});
  await emitEnvelope(io, sessionId, "ai.speaking", {});

  let fullText = "";
  let sentenceBuffer = "";
  let playbackChain = Promise.resolve();
  let firstSentencePcm = null;
  let isFirstSentence = true;
  let firstAudioMarked = false;

  function markFirstAudioOnce() {
    if (firstAudioMarked) return;
    firstAudioMarked = true;
    turnMetrics.mark(sessionId, "ttsFirstAudio");
    turnMetrics.mark(sessionId, "playbackStart");
  }

  function enqueueSentence(sentence) {
    const captureAsFirst = isFirstSentence;
    isFirstSentence = false;
    // Chained (not awaited here) so sentence N+1 can start synthesizing as
    // soon as it's chunked, without waiting for sentence N's *playback* to
    // finish — this is Phase 7's queue: no dead-air gap between sentences
    // waiting purely on TTS latency.
    playbackChain = playbackChain.then(async () => {
      const result = await synthesizeAndPlay(sessionId, sentence, {
        cacheable: false,
        signal,
        turnId,
        onFirstAudio: markFirstAudioOnce,
      });
      if (captureAsFirst) firstSentencePcm = result.pcm;
    });
  }

  try {
    const stream = await streamFn();
    let firstTokenMarked = false;
    // doc/real_time_interview_communication_improvement.md Phase 9 (§19 "LLM
    // timeout"): llmClient.js's own timeout only bounds getting the stream
    // started — once flowing, a stall between chunks (no error, just no more
    // data) would otherwise hang this loop, and the turn, forever. Each
    // .next() is raced against the same requestTimeoutMs budget; a stall
    // throws a plain Error, falling into the catch below exactly like any
    // other genuine streaming failure (-> fallbackFn() -> speak()).
    const iterator = stream[Symbol.asyncIterator]();
    while (true) {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`LLM stream stalled for ${env.openai.requestTimeoutMs}ms`)),
          env.openai.requestTimeoutMs
        );
      });
      let step;
      try {
        step = await Promise.race([iterator.next(), timeout]);
      } finally {
        clearTimeout(timer);
      }
      if (step.done) break;
      const chunk = step.value;

      if (!firstTokenMarked) {
        turnMetrics.mark(sessionId, "llmFirstToken");
        firstTokenMarked = true;
      }
      fullText += chunk.content || "";
      sentenceBuffer += chunk.content || "";
      const { sentences, remainder } = sentenceChunker.extractCompleteSentences(sentenceBuffer);
      sentenceBuffer = remainder;
      for (const sentence of sentences) enqueueSentence(sentence);
    }
    if (sentenceBuffer.trim()) enqueueSentence(sentenceBuffer.trim());
    await playbackChain;
  } catch (err) {
    if (signal?.aborted) {
      logger.info(`speakGenerated cancelled by barge-in sessionId=${sessionId}`);
      throw err;
    }
    logger.warn(`Streaming LLM->TTS failed sessionId=${sessionId}, falling back to non-streamed generation:`, err.message);
    const text = await fallbackFn();
    await speak(io, sessionId, text);
    return text;
  }

  turnMetrics.mark(sessionId, "playbackEnd");
  turnMetrics.finish(sessionId);

  // Matches every batch generateX()'s own .trim() on the raw LLM output —
  // fullText accumulates every chunk's exact characters (trailing
  // whitespace on the final chunk included), unlike sentenceBuffer, which
  // gets its leading whitespace trimmed at each confirmed sentence boundary.
  fullText = fullText.trim();

  await emitEnvelope(io, sessionId, "transcript.final", { speaker: "ai", text: fullText });
  sessionRepository.insertTranscriptRow(sessionId, "ai", fullText);
  await sessionStore.appendHistory(sessionId, { role: "assistant", content: fullText });

  // Approximated from the first sentence's audio only, not every sentence —
  // consistent with this codebase's existing viseme approach already being
  // a "good enough, not sample-accurate" amplitude-envelope estimate (see
  // speak()'s own comment above), not a new regression.
  if (firstSentencePcm) {
    const envelope = visemeEstimator.estimateEnvelope(firstSentencePcm);
    await emitEnvelope(io, sessionId, "ai.visemes", envelope);
  }

  await emitEnvelope(io, sessionId, "ai.response.completed", {});
  return fullText;
}

async function endSession(io, sessionId, reason) {
  // 03-LIVE-INTERVIEW-MODULE.md §2.5/§11: ACTIVE -> COMPLETING -> COMPLETED —
  // persist the transient COMPLETING status before the terminal write below.
  await sessionRepository.markSessionCompleting(sessionId);
  await emitEnvelope(io, sessionId, "interview.state", { status: "COMPLETING", current_section: null });

  // 03-LIVE-INTERVIEW-MODULE.md §11: "report.started is always logged the
  // moment generation is enqueued (not when it finishes)." Phase 4 (Layer 3)
  // made this a real trigger — evaluationPipeline.generateReport(sessionId)
  // fires right after markSessionCompleted below. reportStatusController.js
  // now reports GENERATING/COMPLETED/FAILED for real, read from
  // dbo.interview_reports, instead of hardcoding PENDING.
  await emitEnvelope(io, sessionId, "report.started", {});

  // doc 03 §14: "finish pending persistence" happens before the rest of
  // teardown — persist completion first so a client that reacts to
  // session.completed by navigating away can never race ahead of the write.
  await sessionRepository.markSessionCompleted(sessionId, reason);

  // Phase 4 (Layer 3): fires the actual report-generation pipeline this
  // service now has (evaluation/evaluationPipeline.js), making report.started
  // above a real trigger instead of a marker with no consumer. Must go AFTER
  // markSessionCompleted, not alongside report.started — the pipeline's
  // sessionDataLoader asserts interview_sessions.status === 'COMPLETED' in
  // SQL, which is only true once the write above has actually run.
  // Fire-and-forget: a dozen+ sequential LLM calls must never block session
  // teardown/socket close, matching the same pattern already used for
  // interviewController.startInterview in webrtc/peerConnectionManager.js.
  evaluationPipeline.generateReport(sessionId).catch((err) => {
    logger.error(`report generation failed sessionId=${sessionId}:`, err.message);
  });

  await emitEnvelope(io, sessionId, "session.completed", { reason: reason || "candidate_ended" });
  await emitEnvelope(io, sessionId, "interview.state", { status: "COMPLETED", current_section: null });

  // Lazy require to avoid a circular require with peerConnectionManager
  // (which lazily requires this module to fire the AI greeting on connect),
  // and with audioInbound (which lazily requires this module to hand off a
  // flushed utterance).
  const peerConnectionManager = require("../webrtc/peerConnectionManager");
  const audioInbound = require("../webrtc/audioInbound");
  peerConnectionManager.closePeerConnection(sessionId);

  // doc 04 §12's final timeline event — emitted before the Redis cleanup
  // below (which deletes the sequence counter) so it keeps its correct
  // place in the ordered log instead of restarting the sequence at 1.
  await emitEnvelope(io, sessionId, "session.closed", { reason: reason || "candidate_ended" });

  conversationGate.clearSession(sessionId);
  audioOutbound.clearSession(sessionId);
  // doc/real_time_interview_communication_improvement.md Phase 5: also
  // closes any still-open realtime STT WebSocket — audioInbound.clearSession
  // itself calls sttStreamClient.closeSession, so this one call covers both
  // (previously missing here entirely, a small pre-existing gap found while
  // adding the new one).
  audioInbound.clearSession(sessionId);
  await sessionStore.endSession(sessionId);
}

module.exports = {
  startInterview,
  onCandidateUtterance,
  endSession,
  askNextQuestion,
  handleCodingSubmission,
  handleMcqSubmission,
  handleSkip,
  handleSkipSection,
};
