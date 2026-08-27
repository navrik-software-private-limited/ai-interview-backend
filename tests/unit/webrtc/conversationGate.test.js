jest.mock("../../../interviewer/turnMetrics");
const turnMetrics = require("../../../interviewer/turnMetrics");
const conversationGate = require("../../../webrtc/conversationGate");

const SESSION_ID = "session-1";

describe("webrtc/conversationGate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    conversationGate.clearSession(SESSION_ID);
  });

  test("isAiBusy is false until setAiBusy is called", () => {
    expect(conversationGate.isAiBusy(SESSION_ID)).toBe(false);
    conversationGate.setAiBusy(SESSION_ID);
    expect(conversationGate.isAiBusy(SESSION_ID)).toBe(true);
  });

  test("setAiBusy returns an incrementing turnId per session, independent across sessions", () => {
    const first = conversationGate.setAiBusy(SESSION_ID);
    expect(first.turnId).toBe(1);

    const otherSession = conversationGate.setAiBusy("session-2");
    expect(otherSession.turnId).toBe(1); // independent counters
  });

  test("getSignal/getTurnId reflect the current turn, undefined when not busy", () => {
    expect(conversationGate.getSignal(SESSION_ID)).toBeUndefined();
    expect(conversationGate.getTurnId(SESSION_ID)).toBeUndefined();

    const { turnId } = conversationGate.setAiBusy(SESSION_ID);

    expect(conversationGate.getSignal(SESSION_ID)).toBeInstanceOf(AbortSignal);
    expect(conversationGate.getTurnId(SESSION_ID)).toBe(turnId);
    expect(conversationGate.getSignal(SESSION_ID).aborted).toBe(false);
  });

  test("isCurrentTurn is true for the live turnId, false for anything else", () => {
    const { turnId } = conversationGate.setAiBusy(SESSION_ID);

    expect(conversationGate.isCurrentTurn(SESSION_ID, turnId)).toBe(true);
    expect(conversationGate.isCurrentTurn(SESSION_ID, turnId + 1)).toBe(false);
    expect(conversationGate.isCurrentTurn("no-such-session", turnId)).toBe(false);
  });

  test("releaseAiBusy with the current turnId clears the gate after the delay", (done) => {
    const { turnId } = conversationGate.setAiBusy(SESSION_ID);

    conversationGate.releaseAiBusy(SESSION_ID, turnId, 5);

    setTimeout(() => {
      expect(conversationGate.isAiBusy(SESSION_ID)).toBe(false);
      done();
    }, 20);
  });

  test("releaseAiBusy with a stale turnId — because a newer turn already took over — is a no-op", (done) => {
    const { turnId: firstTurnId } = conversationGate.setAiBusy(SESSION_ID);
    conversationGate.releaseAiBusy(SESSION_ID, firstTurnId, 5); // scheduled, but a newer turn starts before it fires

    const { turnId: secondTurnId } = conversationGate.setAiBusy(SESSION_ID);
    expect(secondTurnId).not.toBe(firstTurnId);

    setTimeout(() => {
      // still busy — the stale release must not have cleared the newer turn's state
      expect(conversationGate.isAiBusy(SESSION_ID)).toBe(true);
      expect(conversationGate.getTurnId(SESSION_ID)).toBe(secondTurnId);
      done();
    }, 20);
  });

  test("interrupt() aborts the current turn's signal, logs its turn-metrics, and frees the gate", () => {
    const { turnId } = conversationGate.setAiBusy(SESSION_ID);
    const signal = conversationGate.getSignal(SESSION_ID);

    const result = conversationGate.interrupt(SESSION_ID);

    expect(result).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(turnMetrics.mark).toHaveBeenCalledWith(SESSION_ID, "interruptStart");
    expect(turnMetrics.mark).toHaveBeenCalledWith(SESSION_ID, "aiPlaybackStopped");
    expect(turnMetrics.finish).toHaveBeenCalledWith(SESSION_ID);
    expect(conversationGate.isAiBusy(SESSION_ID)).toBe(false);
    expect(conversationGate.isCurrentTurn(SESSION_ID, turnId)).toBe(false);
  });

  test("interrupt() with nothing active is a safe no-op", () => {
    const result = conversationGate.interrupt(SESSION_ID);
    expect(result).toBe(false);
    expect(turnMetrics.mark).not.toHaveBeenCalled();
  });

  test("a subsequent setAiBusy after interrupt() gets a fresh, non-aborted signal", () => {
    conversationGate.setAiBusy(SESSION_ID);
    conversationGate.interrupt(SESSION_ID);

    const { turnId } = conversationGate.setAiBusy(SESSION_ID);
    expect(turnId).toBe(2);
    expect(conversationGate.getSignal(SESSION_ID).aborted).toBe(false);
  });

  test("clearSession aborts any live controller and frees the gate", () => {
    conversationGate.setAiBusy(SESSION_ID);
    const signal = conversationGate.getSignal(SESSION_ID);

    conversationGate.clearSession(SESSION_ID);

    expect(signal.aborted).toBe(true);
    expect(conversationGate.isAiBusy(SESSION_ID)).toBe(false);
  });

  test("clearSession with nothing active does not throw", () => {
    expect(() => conversationGate.clearSession(SESSION_ID)).not.toThrow();
  });
});
