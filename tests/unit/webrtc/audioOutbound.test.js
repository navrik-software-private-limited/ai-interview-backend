jest.mock("../../../webrtc/peerConnectionManager", () => ({
  getAudioSource: jest.fn(),
}));
jest.mock("../../../webrtc/conversationGate", () => ({
  isCurrentTurn: jest.fn(),
}));

const peerConnectionManager = require("../../../webrtc/peerConnectionManager");
const conversationGate = require("../../../webrtc/conversationGate");
const { playPcmBuffer, clearSession } = require("../../../webrtc/audioOutbound");

const SESSION_ID = "session-1";
const SAMPLES_PER_FRAME = 480; // 10ms @ 48000Hz, matches the module under test

function pcmFrames(frameCount) {
  return Buffer.alloc(frameCount * SAMPLES_PER_FRAME * 2); // Int16 = 2 bytes/sample
}

function fakeAudioSource() {
  return { onData: jest.fn() };
}

describe("webrtc/audioOutbound.playPcmBuffer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearSession(SESSION_ID);
  });

  test("does nothing if the connection is already gone", async () => {
    peerConnectionManager.getAudioSource.mockReturnValue(null);

    await playPcmBuffer(SESSION_ID, pcmFrames(3), 1);

    expect(conversationGate.isCurrentTurn).not.toHaveBeenCalled();
  });

  test("plays every frame when turnId is omitted (backward compatible — no staleness check at all)", async () => {
    const source = fakeAudioSource();
    peerConnectionManager.getAudioSource.mockReturnValue(source);

    await playPcmBuffer(SESSION_ID, pcmFrames(3));

    expect(conversationGate.isCurrentTurn).not.toHaveBeenCalled();
    expect(source.onData).toHaveBeenCalledTimes(3);
  });

  test("plays every frame when the turn stays current throughout", async () => {
    const source = fakeAudioSource();
    peerConnectionManager.getAudioSource.mockReturnValue(source);
    conversationGate.isCurrentTurn.mockReturnValue(true);

    await playPcmBuffer(SESSION_ID, pcmFrames(3), 1);

    expect(source.onData).toHaveBeenCalledTimes(3);
  });

  test("doc/real_time_interview_communication_improvement.md Phase 3: stops within one frame once isCurrentTurn goes false mid-loop (barge-in)", async () => {
    const source = fakeAudioSource();
    peerConnectionManager.getAudioSource.mockReturnValue(source);
    // current for the pre-loop check and frame 1, then superseded before frame 2
    conversationGate.isCurrentTurn.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false);

    await playPcmBuffer(SESSION_ID, pcmFrames(5), 1);

    expect(source.onData).toHaveBeenCalledTimes(1);
  });

  test("never even starts playing if already superseded before the first frame", async () => {
    const source = fakeAudioSource();
    peerConnectionManager.getAudioSource.mockReturnValue(source);
    conversationGate.isCurrentTurn.mockReturnValue(false);

    await playPcmBuffer(SESSION_ID, pcmFrames(5), 1);

    expect(source.onData).not.toHaveBeenCalled();
  });

  test("queues calls for the same session so frames never interleave — a second call waits for the first", async () => {
    const source = fakeAudioSource();
    peerConnectionManager.getAudioSource.mockReturnValue(source);
    conversationGate.isCurrentTurn.mockReturnValue(true);

    const callOrder = [];

    const first = playPcmBuffer(SESSION_ID, pcmFrames(2), 1).then(() => callOrder.push("first-done"));
    const second = playPcmBuffer(SESSION_ID, pcmFrames(2), 1).then(() => callOrder.push("second-done"));

    await Promise.all([first, second]);

    expect(callOrder).toEqual(["first-done", "second-done"]);
    expect(source.onData).toHaveBeenCalledTimes(4);
  });
});
