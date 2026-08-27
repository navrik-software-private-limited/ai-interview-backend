// Must come before anything that transitively requires it: config/redis.js
// opens a REAL ioredis connection as a module-load side effect. audioInbound.js
// now requires communication/envelope.js (for the ai.interrupted barge-in
// envelope), which requires session/sessionStore.js -> config/redis.js — so
// this needs the same guard every other test file that reaches that chain
// already uses.
jest.mock("../../../config/redis", () => require("../../helpers/mockRedis").createMockRedisClient());
jest.mock("../../../communication/envelope");
jest.mock("../../../webrtc/conversationGate");
jest.mock("../../../interviewer/turnMetrics");
jest.mock("../../../speech/sttStreamClient");
jest.mock("../../../interviewer/interviewController", () => ({
  onCandidateUtterance: jest.fn(),
}));

const { emitEnvelope } = require("../../../communication/envelope");
const conversationGate = require("../../../webrtc/conversationGate");
const turnMetrics = require("../../../interviewer/turnMetrics");
const sttStreamClient = require("../../../speech/sttStreamClient");
const interviewController = require("../../../interviewer/interviewController");
const {
  handleInboundAudioFrame,
  clearSession,
  COMPLETION_SILENCE_MS,
  MAX_UTTERANCE_MS,
  MIN_UTTERANCE_MS,
  BARGE_IN_SPEECH_MS,
} = require("../../../webrtc/audioInbound");

const SAMPLE_RATE = 48000;
const FRAME_MS = 10;
const SPEECH_FRAMES_FOR = (ms) => Math.ceil(ms / FRAME_MS);

function speechFrame() {
  return { samples: new Int16Array(480).fill(2000), sampleRate: SAMPLE_RATE }; // RMS well above the 500 threshold
}

function silenceFrame() {
  return { samples: new Int16Array(480).fill(0), sampleRate: SAMPLE_RATE };
}

function feed(count, frame) {
  for (let i = 0; i < count; i++) handleInboundAudioFrame(SESSION_ID, frame(), io);
}

const SESSION_ID = "session-1";
const io = {};

describe("webrtc/audioInbound.handleInboundAudioFrame", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    conversationGate.isAiBusy.mockReturnValue(false);
    clearSession(SESSION_ID);
  });

  describe("normal listening (Part A: pause-tolerant turn detection)", () => {
    test("starts a turn and marks candidateSpeechStart on the first speech frame of a fresh buffer", () => {
      handleInboundAudioFrame(SESSION_ID, speechFrame(), io);

      expect(turnMetrics.startTurn).toHaveBeenCalledWith(SESSION_ID);
      expect(turnMetrics.mark).toHaveBeenCalledWith(SESSION_ID, "candidateSpeechStart");
      expect(interviewController.onCandidateUtterance).not.toHaveBeenCalled(); // too short to flush yet
    });

    test("does not start a second turn for subsequent speech frames of the same utterance", () => {
      feed(3, speechFrame);

      expect(turnMetrics.startTurn).toHaveBeenCalledTimes(1);
      expect(turnMetrics.mark).toHaveBeenCalledTimes(1);
    });

    test("doc/real_time_interview_communication_improvement.md Phase 5: opens the realtime STT stream once on the first speech frame, and feeds it every speech frame", () => {
      feed(3, speechFrame);

      expect(sttStreamClient.openIfNeeded).toHaveBeenCalledTimes(1);
      expect(sttStreamClient.openIfNeeded).toHaveBeenCalledWith(SESSION_ID, SAMPLE_RATE, expect.any(Function));
      expect(sttStreamClient.sendChunk).toHaveBeenCalledTimes(3);
    });

    test("a partial transcript from the stream marks sttFirstPartial and emits transcript.partial", () => {
      handleInboundAudioFrame(SESSION_ID, speechFrame(), io);
      const onPartial = sttStreamClient.openIfNeeded.mock.calls[0][2];

      onPartial("hel");

      expect(turnMetrics.mark).toHaveBeenCalledWith(SESSION_ID, "sttFirstPartial");
      expect(emitEnvelope).toHaveBeenCalledWith(io, SESSION_ID, "transcript.partial", { speaker: "candidate", text: "hel" });
    });

    test("a short pause (well under COMPLETION_SILENCE_MS) does not flush, and speech resuming after it continues the same utterance", () => {
      feed(SPEECH_FRAMES_FOR(MIN_UTTERANCE_MS), speechFrame); // enough speech to count
      feed(SPEECH_FRAMES_FOR(700), silenceFrame); // a natural short thinking pause
      expect(interviewController.onCandidateUtterance).not.toHaveBeenCalled();

      feed(5, speechFrame); // candidate resumes talking
      feed(SPEECH_FRAMES_FOR(700), silenceFrame); // another short pause, still not enough

      expect(interviewController.onCandidateUtterance).not.toHaveBeenCalled();
      // still one turn/utterance the whole time, not restarted by the pause
      expect(turnMetrics.startTurn).toHaveBeenCalledTimes(1);
    });

    test("flushes only once silence reaches COMPLETION_SILENCE_MS, after enough total speech", () => {
      feed(SPEECH_FRAMES_FOR(MIN_UTTERANCE_MS), speechFrame);
      feed(SPEECH_FRAMES_FOR(COMPLETION_SILENCE_MS) - 1, silenceFrame);
      expect(interviewController.onCandidateUtterance).not.toHaveBeenCalled();

      handleInboundAudioFrame(SESSION_ID, silenceFrame(), io);

      expect(turnMetrics.mark).toHaveBeenCalledWith(SESSION_ID, "candidateSpeechEnd");
      expect(interviewController.onCandidateUtterance).toHaveBeenCalledTimes(1);
      expect(interviewController.onCandidateUtterance).toHaveBeenCalledWith(io, SESSION_ID, expect.any(Buffer), SAMPLE_RATE);
    });

    test("does not flush an utterance shorter than MIN_UTTERANCE_MS, no matter how much silence follows", () => {
      feed(5, speechFrame); // only 50ms of speech
      feed(SPEECH_FRAMES_FOR(COMPLETION_SILENCE_MS) + 20, silenceFrame);

      expect(interviewController.onCandidateUtterance).not.toHaveBeenCalled();
    });

    test("MAX_UTTERANCE_MS force-flushes even with no silence at all", () => {
      feed(SPEECH_FRAMES_FOR(MAX_UTTERANCE_MS), speechFrame);

      expect(interviewController.onCandidateUtterance).toHaveBeenCalledTimes(1);
    });
  });

  describe("barge-in (Part C) — sustained speech while the AI is busy", () => {
    beforeEach(() => conversationGate.isAiBusy.mockReturnValue(true));

    test("an isolated speech frame does not trigger an interrupt", () => {
      handleInboundAudioFrame(SESSION_ID, speechFrame(), io);

      expect(conversationGate.interrupt).not.toHaveBeenCalled();
      expect(emitEnvelope).not.toHaveBeenCalled();
    });

    test("silence resets the barge-in candidate counter — alternating blips never accumulate", () => {
      for (let i = 0; i < 10; i++) {
        handleInboundAudioFrame(SESSION_ID, speechFrame(), io);
        handleInboundAudioFrame(SESSION_ID, silenceFrame(), io);
      }

      expect(conversationGate.interrupt).not.toHaveBeenCalled();
    });

    test("sustained speech reaching BARGE_IN_SPEECH_MS triggers interrupt, emits ai.interrupted, and starts a new turn seeded with the accumulated frames", () => {
      feed(SPEECH_FRAMES_FOR(BARGE_IN_SPEECH_MS) - 1, speechFrame);
      expect(conversationGate.interrupt).not.toHaveBeenCalled();

      handleInboundAudioFrame(SESSION_ID, speechFrame(), io);

      expect(conversationGate.interrupt).toHaveBeenCalledWith(SESSION_ID);
      expect(emitEnvelope).toHaveBeenCalledWith(io, SESSION_ID, "ai.interrupted", {});
      expect(turnMetrics.startTurn).toHaveBeenCalledWith(SESSION_ID);
      expect(turnMetrics.mark).toHaveBeenCalledWith(SESSION_ID, "candidateSpeechStart");
      // the seeded utterance also opens/feeds its own realtime STT stream, same as a normal turn
      expect(sttStreamClient.openIfNeeded).toHaveBeenCalledWith(SESSION_ID, SAMPLE_RATE, expect.any(Function));
      expect(sttStreamClient.sendChunk).toHaveBeenCalled();
    });

    test("after an interrupt, the seeded utterance continues as a normal turn and can itself flush", () => {
      conversationGate.isAiBusy.mockReturnValue(true);
      feed(SPEECH_FRAMES_FOR(BARGE_IN_SPEECH_MS), speechFrame); // crosses the barge-in threshold, interrupt fires

      conversationGate.isAiBusy.mockReturnValue(false); // gate is now free, same as after any interrupt() call
      // BARGE_IN_SPEECH_MS alone is below MIN_UTTERANCE_MS — the candidate
      // needs to keep talking a bit past the barge-in trigger point before
      // any silence can flush it, same as a normal utterance would.
      feed(SPEECH_FRAMES_FOR(MIN_UTTERANCE_MS), speechFrame);
      feed(SPEECH_FRAMES_FOR(COMPLETION_SILENCE_MS), silenceFrame);

      expect(interviewController.onCandidateUtterance).toHaveBeenCalledTimes(1);
      // only started once — at the barge-in moment — not a second time when normal listening resumed
      expect(turnMetrics.startTurn).toHaveBeenCalledTimes(1);
    });
  });

  test("clearSession clears both the utterance buffer and any pending barge-in candidate", () => {
    conversationGate.isAiBusy.mockReturnValue(true);
    handleInboundAudioFrame(SESSION_ID, speechFrame(), io); // starts accumulating a barge-in candidate

    clearSession(SESSION_ID);
    conversationGate.isAiBusy.mockReturnValue(false);
    feed(SPEECH_FRAMES_FOR(MIN_UTTERANCE_MS), speechFrame);

    // a fresh turn, not a continuation of whatever was mid-barge-in before clearSession
    expect(turnMetrics.startTurn).toHaveBeenCalledTimes(1);
  });

  test("clearSession also closes any open realtime STT stream", () => {
    clearSession(SESSION_ID);
    expect(sttStreamClient.closeSession).toHaveBeenCalledWith(SESSION_ID);
  });
});
