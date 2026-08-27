// Integration tests for interviewer/interviewController.js — the live
// interview state machine. Every external dependency (LLM-backed modules,
// STT/TTS, DB/Redis-backed repositories, WebRTC/turn-gating) is mocked; only
// question-engine/sectionPlan.js and question-engine/interactionTypePlan.js
// are left real, since they're pure section-sequencing logic and exercising
// them for real is exactly what makes the "full section sequence" behavior
// meaningful to test.

// Must be mocked before anything that transitively requires it: config/redis.js
// opens a REAL ioredis connection as a module-load side effect (`new Redis(...)`
// at top level, not lazy). Without this, automocking communication/envelope or
// session/sessionStore still loads the real module tree once to introspect its
// shape — which was opening a live connection to the dev Redis instance and
// leaving the process unable to exit (a real TCP handle stays open).
jest.mock("../../config/redis", () => require("../helpers/mockRedis").createMockRedisClient());

jest.mock("../../communication/envelope");
jest.mock("../../session/sessionStore");
jest.mock("../../session/sessionRepository");
jest.mock("../../session/candidateRepository");
jest.mock("../../speech/sttStreamClient");
jest.mock("../../speech/ttsClient");
jest.mock("../../speech/ttsCache");
jest.mock("../../speech/visemeEstimator");
jest.mock("../../webrtc/audioOutbound");
jest.mock("../../webrtc/conversationGate");
jest.mock("../../interviewer/turnMetrics");
jest.mock("../../question-engine/greeting");
jest.mock("../../question-engine/questionGenerator");
jest.mock("../../question-engine/followUpDecider");
jest.mock("../../coding/codingProblemGenerator");
jest.mock("../../coding/codeEvaluator");
jest.mock("../../coding/codingSubmissionRepository");
jest.mock("../../admin/adminConfigRepository");
jest.mock("../../evaluation/evaluationPipeline");
jest.mock("../../case-study/caseFlowController");
// Explicit factory (not automock): peerConnectionManager.js requires the
// native @roamhq/wrtc addon at module top-level — automocking would still
// load the real module first to introspect its shape, pulling in that
// native binary just for a mock. A factory sidesteps requiring it at all.
jest.mock("../../webrtc/peerConnectionManager", () => ({
  handleOffer: jest.fn(),
  addIceCandidate: jest.fn(),
  getAudioSource: jest.fn(),
  closePeerConnection: jest.fn(),
}));

const { emitEnvelope } = require("../../communication/envelope");
const sessionStore = require("../../session/sessionStore");
const sessionRepository = require("../../session/sessionRepository");
const candidateRepository = require("../../session/candidateRepository");
const sttStreamClient = require("../../speech/sttStreamClient");
const ttsClient = require("../../speech/ttsClient");
const ttsCache = require("../../speech/ttsCache");
const visemeEstimator = require("../../speech/visemeEstimator");
const audioOutbound = require("../../webrtc/audioOutbound");
const conversationGate = require("../../webrtc/conversationGate");
const turnMetrics = require("../../interviewer/turnMetrics");
const greeting = require("../../question-engine/greeting");
const questionGenerator = require("../../question-engine/questionGenerator");
const followUpDecider = require("../../question-engine/followUpDecider");
const codingProblemGenerator = require("../../coding/codingProblemGenerator");
const codeEvaluator = require("../../coding/codeEvaluator");
const codingSubmissionRepository = require("../../coding/codingSubmissionRepository");
const adminConfigRepository = require("../../admin/adminConfigRepository");
const evaluationPipeline = require("../../evaluation/evaluationPipeline");
const caseFlowController = require("../../case-study/caseFlowController");
const peerConnectionManager = require("../../webrtc/peerConnectionManager");

const interviewController = require("../../interviewer/interviewController");

const SESSION_ID = "session-1";

function baseSession(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    currentSection: "JD_RESUME",
    questionsAskedInSection: 0,
    currentQuestionAskedId: null,
    currentQuestionIsFollowUp: false,
    currentQuestionText: null,
    conversationHistory: [],
    sectionOrder: null,
    sectionTargets: null,
    sectionInteraction: null,
    awaitingCaseAcknowledgement: false,
    currentCodingProblem: null,
    codingProblemTitles: [],
    resumeContext: null,
    caseContentText: null,
    ...overrides,
  };
}

function fakeIo() {
  return { to: jest.fn(() => ({ emit: jest.fn() })) };
}

// doc/real_time_interview_communication_improvement.md Phase 6: a minimal
// async-iterable stream, same shape LangChain's model.stream() chunks have
// ({content}). Single-chunk by default so text ends up identical to what
// the batch mocks below already produce — existing assertions on the final
// spoken/transcribed text stay valid whether the streaming or batch path ran.
async function* fakeStream(text) {
  yield { content: text };
}

describe("interviewer/interviewController", () => {
  let io;

  beforeEach(() => {
    jest.clearAllMocks();
    io = fakeIo();

    conversationGate.setAiBusy.mockReturnValue({ turnId: 1 });
    conversationGate.getSignal.mockReturnValue(undefined);
    conversationGate.getTurnId.mockReturnValue(1);
    conversationGate.isCurrentTurn.mockReturnValue(true);

    adminConfigRepository.getActiveConfiguration.mockResolvedValue(null);
    sessionStore.getSession.mockResolvedValue(baseSession());
    sessionStore.touchSession.mockResolvedValue(undefined);
    sessionStore.appendHistory.mockResolvedValue(undefined);
    sessionStore.getHistory.mockResolvedValue([]);
    sessionRepository.insertQuestionAskedRow.mockResolvedValue("question-id-1");
    sessionRepository.updateSessionSection.mockResolvedValue(undefined);
    sessionRepository.markSessionCompleting.mockResolvedValue(undefined);
    sessionRepository.markSessionCompleted.mockResolvedValue(undefined);
    sessionRepository.recordMcqAnswer.mockResolvedValue(undefined);

    candidateRepository.fetchCandidateName.mockResolvedValue(null);
    greeting.buildGreeting.mockResolvedValue({ text: "Hi, welcome to your interview.", cacheable: true });
    questionGenerator.generateQuestion.mockResolvedValue("Tell me about your last project.");
    questionGenerator.generateQuestionStream.mockImplementation(() => fakeStream("Tell me about your last project."));
    questionGenerator.generateFollowUp.mockResolvedValue("Can you go deeper on that?");
    questionGenerator.generateFollowUpStream.mockImplementation(() => fakeStream("Can you go deeper on that?"));
    questionGenerator.generateCasePresentation.mockResolvedValue("Here's the case.");
    questionGenerator.generateCasePresentationStream.mockImplementation(() => fakeStream("Here's the case."));
    questionGenerator.generateMcqQuestion.mockResolvedValue({
      questionText: "Pick one.",
      options: [{ key: "A", text: "opt A" }, { key: "B", text: "opt B" }],
      correctOption: "A",
    });
    followUpDecider.shouldFollowUp.mockResolvedValue({ followUp: false, reason: "not needed" });

    sttStreamClient.finishTranscription.mockResolvedValue("This is my answer.");

    ttsCache.getOrSynthesize.mockResolvedValue(Buffer.alloc(10));
    ttsClient.synthesizeSpeech.mockResolvedValue(Buffer.alloc(10));
    ttsClient.synthesizeSpeechStreaming.mockImplementation(async (text, onChunk) => {
      const chunk = Buffer.alloc(10);
      if (onChunk) onChunk(chunk);
      return chunk;
    });
    ttsClient.silentPcmBuffer = jest.fn(() => Buffer.alloc(10));
    ttsClient.SILENCE_FALLBACK_MS = 500;
    visemeEstimator.estimateEnvelope.mockReturnValue({ visemes: [], durationMs: 0 });
    audioOutbound.playPcmBuffer.mockResolvedValue(undefined);

    codingProblemGenerator.generateProblem.mockResolvedValue({
      problemId: "problem-1",
      title: "Sort an Array",
      statement: "Sort it.",
      examples: [],
      constraints: [],
    });
    codeEvaluator.evaluateSubmission.mockResolvedValue({
      correctness_assessment: "Looks correct.",
      explanation_needed: null,
    });

    evaluationPipeline.generateReport.mockResolvedValue({});
  });

  describe("startInterview", () => {
    test("greets, then transitions into the first question section", async () => {
      await interviewController.startInterview(io, SESSION_ID);

      expect(conversationGate.setAiBusy).toHaveBeenCalledWith(SESSION_ID);
      expect(conversationGate.releaseAiBusy).toHaveBeenCalledWith(SESSION_ID, 1);
      expect(emitEnvelope).toHaveBeenCalledWith(io, SESSION_ID, "interview.started", {});
      expect(ttsCache.getOrSynthesize).toHaveBeenCalledWith("Hi, welcome to your interview.", expect.anything());
      // Falls through to JD_RESUME (index 1 of the hardcoded SECTION_ORDER) since
      // adminConfigRepository returned no active configuration.
      expect(emitEnvelope).toHaveBeenCalledWith(
        io,
        SESSION_ID,
        "interview.section.started",
        { section: "JD_RESUME" }
      );
      // 2026-08-26 UX fix: batch-generated (text known before speaking).
      expect(questionGenerator.generateQuestion).toHaveBeenCalled();
    });

    test("doc/real_time_interview_communication_improvement.md Phase 1: speak() marks tts/playback turn-metrics and finishes the turn", async () => {
      await interviewController.startInterview(io, SESSION_ID);

      expect(turnMetrics.mark).toHaveBeenCalledWith(SESSION_ID, "ttsStart");
      expect(turnMetrics.mark).toHaveBeenCalledWith(SESSION_ID, "ttsFirstAudio");
      expect(turnMetrics.mark).toHaveBeenCalledWith(SESSION_ID, "playbackStart");
      expect(turnMetrics.mark).toHaveBeenCalledWith(SESSION_ID, "playbackEnd");
      // Called once per speak() — the greeting, plus the JD_RESUME question this test's
      // flow also reaches (see the assertion above: generateQuestion is called too).
      expect(turnMetrics.finish).toHaveBeenCalledWith(SESSION_ID);
    });

    test("falls back through the tiered TTS chain to silence without throwing", async () => {
      ttsCache.getOrSynthesize.mockRejectedValue(new Error("cache synth failed"));
      ttsClient.synthesizeSpeech.mockRejectedValue(new Error("tts also failed"));

      await expect(interviewController.startInterview(io, SESSION_ID)).resolves.toBeUndefined();

      expect(ttsClient.silentPcmBuffer).toHaveBeenCalledWith(500);
      expect(audioOutbound.playPcmBuffer).toHaveBeenCalled();
      expect(emitEnvelope).toHaveBeenCalledWith(io, SESSION_ID, "ai.response.completed", {});
    });

    test("doc/real_time_interview_communication_improvement.md Phase 3: a barge-in mid-greeting stops speak() without falling back, and does not continue into transitionToSection", async () => {
      const controller = new AbortController();
      controller.abort(); // simulates conversationGate.interrupt() already having fired
      conversationGate.getSignal.mockReturnValue(controller.signal);
      conversationGate.isCurrentTurn.mockReturnValue(false); // interrupt() already advanced to a newer turn
      const abortError = new Error("aborted");
      ttsCache.getOrSynthesize.mockRejectedValue(abortError);

      await expect(interviewController.startInterview(io, SESSION_ID)).resolves.toBeUndefined();

      // no fallback tier attempted, no stale "AI finished speaking" signal, no advance into the first section
      expect(ttsClient.synthesizeSpeech).not.toHaveBeenCalled();
      expect(ttsClient.silentPcmBuffer).not.toHaveBeenCalled();
      expect(emitEnvelope).not.toHaveBeenCalledWith(io, SESSION_ID, "ai.response.completed", {});
      expect(questionGenerator.generateQuestion).not.toHaveBeenCalled();
      // the gate is still correctly released (superseded-turn no-op, not left stuck)
      expect(conversationGate.releaseAiBusy).toHaveBeenCalledWith(SESSION_ID, 1);
    });

    test("recovers to a normal (non-silent) reply once the cache tier fails but the plain TTS call succeeds", async () => {
      ttsCache.getOrSynthesize.mockRejectedValue(new Error("cache synth failed"));

      await interviewController.startInterview(io, SESSION_ID);

      expect(ttsClient.synthesizeSpeech).toHaveBeenCalled();
      expect(ttsClient.silentPcmBuffer).not.toHaveBeenCalled();
    });
  });

  describe("askNextQuestion — VOICE_QA vs MCQ", () => {
    test("JD_RESUME defaults to a VOICE_QA question", async () => {
      sessionStore.getSession.mockResolvedValue(baseSession({ currentSection: "JD_RESUME" }));
      await interviewController.askNextQuestion(io, SESSION_ID, "JD_RESUME");

      // 2026-08-26 UX fix: batch-generated (text known before speaking), not
      // streamed — see the "text shown before speaking" describe block below.
      expect(questionGenerator.generateQuestion).toHaveBeenCalled();
      expect(questionGenerator.generateQuestionStream).not.toHaveBeenCalled();
      expect(questionGenerator.generateMcqQuestion).not.toHaveBeenCalled();
      expect(emitEnvelope).toHaveBeenCalledWith(
        io,
        SESSION_ID,
        "question.started",
        expect.objectContaining({ interactionType: "VOICE_QA" })
      );
      // doc/real_time_interview_communication_improvement.md Phase 8: only
      // emitted once the question has actually been spoken and the backend
      // is genuinely waiting on a voice answer — the real "Listening..." moment.
      expect(emitEnvelope).toHaveBeenCalledWith(io, SESSION_ID, "ai.listening", {});
    });

    test("APTITUDE defaults to an MCQ question, and never leaks correctOption to the client", async () => {
      sessionStore.getSession.mockResolvedValue(baseSession({ currentSection: "APTITUDE" }));
      await interviewController.askNextQuestion(io, SESSION_ID, "APTITUDE");

      expect(questionGenerator.generateMcqQuestion).toHaveBeenCalled();
      const call = emitEnvelope.mock.calls.find((c) => c[2] === "question.started");
      expect(call[3]).toEqual(
        expect.objectContaining({ interactionType: "MCQ", options: expect.any(Array) })
      );
      expect(call[3]).not.toHaveProperty("correctOption");
      // doc/real_time_interview_communication_improvement.md Phase 8: MCQ is
      // answered by a click, not a voice reply — the backend isn't
      // "listening" for anything here.
      expect(emitEnvelope).not.toHaveBeenCalledWith(io, SESSION_ID, "ai.listening", {});
    });

    test("is blocked for CASE while awaiting acknowledgement (structural gate)", async () => {
      sessionStore.getSession.mockResolvedValue(
        baseSession({ currentSection: "CASE", awaitingCaseAcknowledgement: true })
      );
      await interviewController.askNextQuestion(io, SESSION_ID, "CASE");

      expect(questionGenerator.generateQuestion).not.toHaveBeenCalled();
      expect(questionGenerator.generateMcqQuestion).not.toHaveBeenCalled();
    });
  });

  describe("text shown before speaking (2026-08-26 UX fix: question/follow-up text must appear before the AI's voice, not after)", () => {
    test("askNextQuestion (VOICE_QA): question.started (with text) is emitted before any TTS synthesis begins", async () => {
      questionGenerator.generateQuestion.mockResolvedValue("What was your biggest challenge?");
      sessionStore.getSession.mockResolvedValue(baseSession({ currentSection: "JD_RESUME" }));

      await interviewController.askNextQuestion(io, SESSION_ID, "JD_RESUME");

      const questionStartedIndex = emitEnvelope.mock.calls.findIndex((c) => c[2] === "question.started");
      expect(questionStartedIndex).toBeGreaterThanOrEqual(0);
      expect(emitEnvelope.mock.calls[questionStartedIndex][3]).toEqual(
        expect.objectContaining({ text: "What was your biggest challenge?" })
      );
      const questionStartedOrder = emitEnvelope.mock.invocationCallOrder[questionStartedIndex];
      const firstTtsOrder = ttsClient.synthesizeSpeechStreaming.mock.invocationCallOrder[0];
      expect(questionStartedOrder).toBeLessThan(firstTtsOrder);
    });

    test("askNextQuestion (VOICE_QA): persists the question row using the full generated text", async () => {
      questionGenerator.generateQuestion.mockResolvedValue("What was your biggest challenge?");
      sessionStore.getSession.mockResolvedValue(baseSession({ currentSection: "JD_RESUME" }));

      await interviewController.askNextQuestion(io, SESSION_ID, "JD_RESUME");

      expect(sessionRepository.insertQuestionAskedRow).toHaveBeenCalledWith(
        SESSION_ID,
        "JD_RESUME",
        1,
        false,
        null,
        "What was your biggest challenge?"
      );
    });

    test("askFollowUp: followup.started now carries the follow-up text, emitted before any TTS synthesis begins", async () => {
      questionGenerator.generateFollowUp.mockResolvedValue("Can you go deeper on that?");
      sessionStore.getSession.mockResolvedValue(
        baseSession({ currentSection: "JD_RESUME", currentQuestionText: "Tell me about yourself." })
      );
      followUpDecider.shouldFollowUp.mockResolvedValue({ followUp: true, reason: "answer lacked depth" });

      await interviewController.onCandidateUtterance(io, SESSION_ID, Buffer.alloc(10), 48000);

      const followupStartedIndex = emitEnvelope.mock.calls.findIndex((c) => c[2] === "followup.started");
      expect(followupStartedIndex).toBeGreaterThanOrEqual(0);
      expect(emitEnvelope.mock.calls[followupStartedIndex][3]).toEqual(
        expect.objectContaining({ text: "Can you go deeper on that?" })
      );
      const followupStartedOrder = emitEnvelope.mock.invocationCallOrder[followupStartedIndex];
      const firstTtsOrder = ttsClient.synthesizeSpeechStreaming.mock.invocationCallOrder[0];
      expect(followupStartedOrder).toBeLessThan(firstTtsOrder);
    });
  });

  describe("transitionToSection — CASE section no longer narrates case content aloud (2026-08-26 UX fix)", () => {
    test("speaks only the short generic prompt, never the real case content, even when caseContentText is available", async () => {
      sessionStore.getSession.mockResolvedValue(
        baseSession({ currentSection: "APTITUDE", caseContentText: "Confidential case narrative..." })
      ); // next section per the real sectionPlan is CASE

      await interviewController.handleSkipSection(io, SESSION_ID);

      expect(questionGenerator.generateCasePresentation).not.toHaveBeenCalled();
      expect(questionGenerator.generateCasePresentationStream).not.toHaveBeenCalled();
      expect(emitEnvelope).toHaveBeenCalledWith(io, SESSION_ID, "transcript.final", {
        speaker: "ai",
        text: "This is the case study section. Please take a moment to read the case study on your screen, and when you're ready, we'll begin the questions on it.",
      });
      // the real case text still reaches the reading panel (caseFlowController.presentCase
      // emits case.presented's content field itself — unaffected by this change).
      expect(caseFlowController.presentCase).toHaveBeenCalledWith(
        io,
        SESSION_ID,
        "Confidential case narrative...",
        "This is the case study section. Please take a moment to read the case study on your screen, and when you're ready, we'll begin the questions on it."
      );
    });

    test("speaks the same prompt even when no real case content is available yet", async () => {
      sessionStore.getSession.mockResolvedValue(baseSession({ currentSection: "APTITUDE", caseContentText: null }));

      await interviewController.handleSkipSection(io, SESSION_ID);

      expect(emitEnvelope).toHaveBeenCalledWith(io, SESSION_ID, "transcript.final", {
        speaker: "ai",
        text: "This is the case study section. Please take a moment to read the case study on your screen, and when you're ready, we'll begin the questions on it.",
      });
    });
  });

  describe("doc/real_time_interview_communication_improvement.md Phase 9: handleSkip / handleSkipSection recovery", () => {
    test("handleSkip speaks a recovery message on a genuine downstream generation failure instead of going silent", async () => {
      sessionStore.getSession.mockResolvedValue(
        baseSession({ currentSection: "JD_RESUME", questionsAskedInSection: 0 })
      );
      questionGenerator.generateQuestion.mockRejectedValue(new Error("llm down"));

      await expect(interviewController.handleSkip(io, SESSION_ID)).resolves.toBeUndefined();

      expect(conversationGate.releaseAiBusy).toHaveBeenCalledWith(SESSION_ID, 1);
      expect(emitEnvelope).toHaveBeenCalledWith(io, SESSION_ID, "transcript.final", {
        speaker: "ai",
        text: "Sorry, I ran into a brief technical issue there. Let's continue.",
      });
    });

    test("handleSkip does not speak a recovery message when the failure is a benign supersession", async () => {
      sessionStore.getSession.mockResolvedValue(
        baseSession({ currentSection: "JD_RESUME", questionsAskedInSection: 0 })
      );
      questionGenerator.generateQuestion.mockRejectedValue(new Error("superseded"));
      conversationGate.isCurrentTurn.mockReturnValue(false);

      await interviewController.handleSkip(io, SESSION_ID);

      expect(emitEnvelope).not.toHaveBeenCalledWith(
        io,
        SESSION_ID,
        "transcript.final",
        expect.objectContaining({ text: expect.stringContaining("technical issue") })
      );
    });

    test("handleSkipSection speaks a recovery message on a genuine downstream generation failure instead of going silent", async () => {
      sessionStore.getSession.mockResolvedValue(baseSession({ currentSection: "CASE" })); // next section is CODING
      codingProblemGenerator.generateProblem.mockRejectedValue(new Error("llm down"));

      await expect(interviewController.handleSkipSection(io, SESSION_ID)).resolves.toBeUndefined();

      expect(conversationGate.releaseAiBusy).toHaveBeenCalledWith(SESSION_ID, 1);
      expect(emitEnvelope).toHaveBeenCalledWith(io, SESSION_ID, "transcript.final", {
        speaker: "ai",
        text: "Sorry, I ran into a brief technical issue there. Let's continue.",
      });
    });
  });

  describe("handleCodingSubmission", () => {
    function codingSession(overrides = {}) {
      return baseSession({
        currentSection: "CODING",
        currentCodingProblem: { problemId: "problem-1", title: "Sort an Array", statement: "Sort it." },
        questionsAskedInSection: 1,
        ...overrides,
      });
    }

    test("does nothing when there's no active coding problem", async () => {
      sessionStore.getSession.mockResolvedValue(baseSession({ currentSection: "CODING", currentCodingProblem: null }));
      await interviewController.handleCodingSubmission(io, SESSION_ID, { code: "print(1)", language: "python" });
      expect(codeEvaluator.evaluateSubmission).not.toHaveBeenCalled();
    });

    test("does nothing when the section isn't CODING", async () => {
      sessionStore.getSession.mockResolvedValue(baseSession({ currentSection: "JD_RESUME" }));
      await interviewController.handleCodingSubmission(io, SESSION_ID, { code: "print(1)" });
      expect(codeEvaluator.evaluateSubmission).not.toHaveBeenCalled();
    });

    test("does nothing when the submitted code is empty/whitespace-only", async () => {
      sessionStore.getSession.mockResolvedValue(codingSession());
      await interviewController.handleCodingSubmission(io, SESSION_ID, { code: "   " });
      expect(codeEvaluator.evaluateSubmission).not.toHaveBeenCalled();
    });

    test("evaluates, persists, and emits coding.submitted for a valid submission, wrapped in the turn gate", async () => {
      sessionStore.getSession.mockResolvedValue(codingSession({ questionsAskedInSection: 1 })); // target is 2, so another problem follows
      await interviewController.handleCodingSubmission(io, SESSION_ID, { code: "def solve(): pass", language: "python" });

      expect(conversationGate.setAiBusy).toHaveBeenCalledWith(SESSION_ID);
      expect(conversationGate.releaseAiBusy).toHaveBeenCalledWith(SESSION_ID, 1);
      expect(codeEvaluator.evaluateSubmission).toHaveBeenCalledWith(
        expect.objectContaining({ statement: "Sort it.", code: "def solve(): pass", language: "python" })
      );
      expect(codingSubmissionRepository.insertCodingSubmission).toHaveBeenCalled();
      expect(emitEnvelope).toHaveBeenCalledWith(
        io,
        SESSION_ID,
        "coding.submitted",
        expect.objectContaining({ problemId: "problem-1" })
      );
      // Target (2) not yet reached -> asks the next coding problem rather than advancing sections.
      expect(codingProblemGenerator.generateProblem).toHaveBeenCalled();
    });

    test("speaks the explanation_needed prompt when the evaluator asks for one", async () => {
      sessionStore.getSession.mockResolvedValue(codingSession({ questionsAskedInSection: 2 })); // target reached -> section completes instead
      codeEvaluator.evaluateSubmission.mockResolvedValue({
        correctness_assessment: "Mostly right.",
        explanation_needed: "Why did you choose that approach?",
      });

      await interviewController.handleCodingSubmission(io, SESSION_ID, { code: "def solve(): pass" });

      expect(ttsClient.synthesizeSpeechStreaming).toHaveBeenCalledWith(
        "Why did you choose that approach?",
        expect.any(Function),
        expect.anything()
      );
    });

    test("moves to the next section once the CODING target question count is reached", async () => {
      sessionStore.getSession.mockResolvedValue(codingSession({ questionsAskedInSection: 2 })); // default CODING target is 2
      await interviewController.handleCodingSubmission(io, SESSION_ID, { code: "def solve(): pass" });

      expect(emitEnvelope).toHaveBeenCalledWith(
        io,
        SESSION_ID,
        "interview.section.completed",
        expect.objectContaining({ section: "CODING" })
      );
      // Real sectionPlan.nextSection("CODING", null) -> "MINDSET" per the hardcoded SECTION_ORDER.
      expect(emitEnvelope).toHaveBeenCalledWith(io, SESSION_ID, "interview.section.started", { section: "MINDSET" });
    });

    test("doc/real_time_interview_communication_improvement.md Phase 9: speaks a recovery message on a genuine evaluation failure instead of going silent", async () => {
      sessionStore.getSession.mockResolvedValue(codingSession({ questionsAskedInSection: 1 }));
      codeEvaluator.evaluateSubmission.mockRejectedValue(new Error("model down"));

      await expect(
        interviewController.handleCodingSubmission(io, SESSION_ID, { code: "def solve(): pass", language: "python" })
      ).resolves.toBeUndefined();

      expect(conversationGate.releaseAiBusy).toHaveBeenCalledWith(SESSION_ID, 1);
      expect(emitEnvelope).toHaveBeenCalledWith(io, SESSION_ID, "transcript.final", {
        speaker: "ai",
        text: "Sorry, I ran into a brief technical issue there. Let's continue.",
      });
    });

    test("doc/real_time_interview_communication_improvement.md Phase 9: does not speak a recovery message when the failure is a benign supersession", async () => {
      sessionStore.getSession.mockResolvedValue(codingSession({ questionsAskedInSection: 1 }));
      codeEvaluator.evaluateSubmission.mockRejectedValue(new Error("model down"));
      conversationGate.isCurrentTurn.mockReturnValue(false);

      await interviewController.handleCodingSubmission(io, SESSION_ID, { code: "def solve(): pass", language: "python" });

      expect(emitEnvelope).not.toHaveBeenCalledWith(
        io,
        SESSION_ID,
        "transcript.final",
        expect.objectContaining({ text: expect.stringContaining("technical issue") })
      );
    });
  });

  describe("onCandidateUtterance", () => {
    test("doc/real_time_interview_communication_improvement.md Phase 8: emits ai.thinking as soon as the candidate's utterance is flushed, before anything else — ai.listening (now emitted later, once a new question is actually spoken) must not come first", async () => {
      sessionStore.getSession.mockResolvedValue(baseSession({ currentSection: "JD_RESUME" }));

      await interviewController.onCandidateUtterance(io, SESSION_ID, Buffer.alloc(10), 48000);

      const thinkingIndex = emitEnvelope.mock.calls.findIndex((c) => c[2] === "ai.thinking");
      const listeningIndex = emitEnvelope.mock.calls.findIndex((c) => c[2] === "ai.listening");
      expect(thinkingIndex).toBeGreaterThanOrEqual(0);
      // listeningIndex may be -1 (not every path re-asks a voice question) or,
      // if it does fire (the default happy path advances to a new VOICE_QA
      // question), it must come strictly after ai.thinking, never before.
      if (listeningIndex !== -1) expect(listeningIndex).toBeGreaterThan(thinkingIndex);
    });

    test("always releases the turn gate, even when STT throws", async () => {
      sttStreamClient.finishTranscription.mockRejectedValue(new Error("stt provider down"));

      await expect(
        interviewController.onCandidateUtterance(io, SESSION_ID, Buffer.alloc(10), 48000)
      ).resolves.toBeUndefined();

      expect(conversationGate.setAiBusy).toHaveBeenCalledWith(SESSION_ID);
      expect(conversationGate.releaseAiBusy).toHaveBeenCalledWith(SESSION_ID, 1);
    });

    test("doc/real_time_interview_communication_improvement.md Phase 9: a genuine STT failure (every fallback tier exhausted) speaks a recovery message and re-opens listening, instead of leaving the frontend silently stuck", async () => {
      sttStreamClient.finishTranscription.mockRejectedValue(new Error("stt provider down"));

      await interviewController.onCandidateUtterance(io, SESSION_ID, Buffer.alloc(10), 48000);

      expect(emitEnvelope).toHaveBeenCalledWith(io, SESSION_ID, "transcript.final", {
        speaker: "ai",
        text: "Sorry, I ran into a brief technical issue there. Let's continue.",
      });
      expect(emitEnvelope).toHaveBeenCalledWith(io, SESSION_ID, "ai.response.completed", {});
      expect(emitEnvelope).toHaveBeenCalledWith(io, SESSION_ID, "ai.listening", {});
    });

    test("doc/real_time_interview_communication_improvement.md Phase 9: a benignly superseded failure (barge-in already moved on) does not speak a recovery message", async () => {
      sttStreamClient.finishTranscription.mockRejectedValue(new Error("stt provider down"));
      conversationGate.isCurrentTurn.mockReturnValue(false);

      await interviewController.onCandidateUtterance(io, SESSION_ID, Buffer.alloc(10), 48000);

      expect(emitEnvelope).not.toHaveBeenCalledWith(
        io,
        SESSION_ID,
        "transcript.final",
        expect.objectContaining({ text: expect.stringContaining("technical issue") })
      );
    });

    test("ignores an empty/silent transcript (no question advance)", async () => {
      sttStreamClient.finishTranscription.mockResolvedValue("   ");
      sessionStore.getSession.mockResolvedValue(baseSession({ currentSection: "JD_RESUME" }));

      await interviewController.onCandidateUtterance(io, SESSION_ID, Buffer.alloc(10), 48000);

      expect(followUpDecider.shouldFollowUp).not.toHaveBeenCalled();
    });

    test("asks a follow-up when the decider says so", async () => {
      sessionStore.getSession.mockResolvedValue(
        baseSession({ currentSection: "JD_RESUME", currentQuestionText: "Tell me about yourself." })
      );
      followUpDecider.shouldFollowUp.mockResolvedValue({ followUp: true, reason: "answer lacked depth" });

      await interviewController.onCandidateUtterance(io, SESSION_ID, Buffer.alloc(10), 48000);

      // 2026-08-26 UX fix: batch-generated (text known before speaking), not
      // streamed.
      expect(questionGenerator.generateFollowUp).toHaveBeenCalled();
      expect(questionGenerator.generateFollowUpStream).not.toHaveBeenCalled();
      expect(emitEnvelope).toHaveBeenCalledWith(
        io,
        SESSION_ID,
        "followup.started",
        expect.objectContaining({ reason: "answer lacked depth", text: "Can you go deeper on that?" })
      );
      // doc/real_time_interview_communication_improvement.md Phase 8: the
      // follow-up has now actually been spoken — the genuine "Listening..." moment.
      expect(emitEnvelope).toHaveBeenCalledWith(io, SESSION_ID, "ai.listening", {});
    });
  });

  describe("handleMcqSubmission", () => {
    test("ignores a submission for the wrong questionAskedId", async () => {
      sessionStore.getSession.mockResolvedValue(
        baseSession({ currentSection: "APTITUDE", currentQuestionAskedId: "q-real" })
      );
      await interviewController.handleMcqSubmission(io, SESSION_ID, { questionAskedId: "q-wrong", selectedOption: "A" });
      expect(sessionRepository.recordMcqAnswer).not.toHaveBeenCalled();
    });

    test("records a matching submission and advances", async () => {
      sessionStore.getSession.mockResolvedValue(
        baseSession({ currentSection: "APTITUDE", currentQuestionAskedId: "q-real", questionsAskedInSection: 1 })
      );
      await interviewController.handleMcqSubmission(io, SESSION_ID, { questionAskedId: "q-real", selectedOption: "B" });

      expect(sessionRepository.recordMcqAnswer).toHaveBeenCalledWith("q-real", "B");
      expect(emitEnvelope).toHaveBeenCalledWith(
        io,
        SESSION_ID,
        "question.completed",
        expect.objectContaining({ questionId: "q-real" })
      );
    });

    test("doc/real_time_interview_communication_improvement.md Phase 9: speaks a recovery message on a genuine failure instead of going silent", async () => {
      sessionStore.getSession.mockResolvedValue(
        baseSession({ currentSection: "APTITUDE", currentQuestionAskedId: "q-real", questionsAskedInSection: 1 })
      );
      sessionRepository.recordMcqAnswer.mockRejectedValue(new Error("db down"));

      await expect(
        interviewController.handleMcqSubmission(io, SESSION_ID, { questionAskedId: "q-real", selectedOption: "B" })
      ).resolves.toBeUndefined();

      expect(conversationGate.releaseAiBusy).toHaveBeenCalledWith(SESSION_ID, 1);
      expect(emitEnvelope).toHaveBeenCalledWith(io, SESSION_ID, "transcript.final", {
        speaker: "ai",
        text: "Sorry, I ran into a brief technical issue there. Let's continue.",
      });
    });

    test("doc/real_time_interview_communication_improvement.md Phase 9: does not speak a recovery message when the failure is a benign supersession", async () => {
      sessionStore.getSession.mockResolvedValue(
        baseSession({ currentSection: "APTITUDE", currentQuestionAskedId: "q-real", questionsAskedInSection: 1 })
      );
      sessionRepository.recordMcqAnswer.mockRejectedValue(new Error("db down"));
      conversationGate.isCurrentTurn.mockReturnValue(false);

      await interviewController.handleMcqSubmission(io, SESSION_ID, { questionAskedId: "q-real", selectedOption: "B" });

      expect(emitEnvelope).not.toHaveBeenCalledWith(
        io,
        SESSION_ID,
        "transcript.final",
        expect.objectContaining({ text: expect.stringContaining("technical issue") })
      );
    });
  });

  describe("endSession", () => {
    test("persists completion, fires the report pipeline, and tears down in the documented order", async () => {
      await interviewController.endSession(io, SESSION_ID, "interview_completed");

      expect(sessionRepository.markSessionCompleting).toHaveBeenCalledWith(SESSION_ID);
      expect(sessionRepository.markSessionCompleted).toHaveBeenCalledWith(SESSION_ID, "interview_completed");
      expect(evaluationPipeline.generateReport).toHaveBeenCalledWith(SESSION_ID);

      // sessionDataLoader asserts status === 'COMPLETED' in SQL, so the report
      // pipeline must only fire after markSessionCompleted has actually run.
      const completedOrder = sessionRepository.markSessionCompleted.mock.invocationCallOrder[0];
      const reportOrder = evaluationPipeline.generateReport.mock.invocationCallOrder[0];
      expect(reportOrder).toBeGreaterThan(completedOrder);

      expect(emitEnvelope).toHaveBeenCalledWith(io, SESSION_ID, "session.completed", { reason: "interview_completed" });
      expect(peerConnectionManager.closePeerConnection).toHaveBeenCalledWith(SESSION_ID);
      expect(conversationGate.clearSession).toHaveBeenCalledWith(SESSION_ID);
      expect(audioOutbound.clearSession).toHaveBeenCalledWith(SESSION_ID);
      expect(sessionStore.endSession).toHaveBeenCalledWith(SESSION_ID);
    });

    test("a report-generation failure is caught and logged, never crashes endSession", async () => {
      evaluationPipeline.generateReport.mockRejectedValue(new Error("pipeline exploded"));
      await expect(interviewController.endSession(io, SESSION_ID, "interview_completed")).resolves.toBeUndefined();
    });
  });
});
