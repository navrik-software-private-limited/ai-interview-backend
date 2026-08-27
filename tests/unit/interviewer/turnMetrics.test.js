jest.mock("../../../logs/logger");
const logger = require("../../../logs/logger");
const turnMetrics = require("../../../interviewer/turnMetrics");

describe("interviewer/turnMetrics", () => {
  beforeEach(() => jest.clearAllMocks());

  test("mark()/finish() are safe no-ops when no turn was started", () => {
    expect(() => turnMetrics.mark("no-such-session", "sttStart")).not.toThrow();
    const result = turnMetrics.finish("no-such-session");
    expect(result).toBeNull();
    expect(logger.info).not.toHaveBeenCalled();
  });

  test("records marks in order and logs one structured line with deltas", () => {
    turnMetrics.startTurn("s1");
    turnMetrics.mark("s1", "sttStart");
    turnMetrics.mark("s1", "sttEnd");

    const record = turnMetrics.finish("s1");

    expect(record.sessionId).toBe("s1");
    expect(record.responseId).toBe("s1:1");
    expect(record.marks.map((m) => m.label)).toEqual(["sttStart", "sttEnd"]);
    expect(record.marks.every((m) => typeof m.offsetMs === "number" && typeof m.deltaMs === "number")).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("turn-metrics"));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('"responseId":"s1:1"'));
  });

  test("a repeated mark for the same label is ignored (first one wins)", () => {
    turnMetrics.startTurn("s2");
    turnMetrics.mark("s2", "ttsFirstAudio");
    turnMetrics.mark("s2", "ttsFirstAudio");
    turnMetrics.mark("s2", "ttsFirstAudio");

    const record = turnMetrics.finish("s2");

    expect(record.marks.filter((m) => m.label === "ttsFirstAudio")).toHaveLength(1);
  });

  test("finish() clears the turn — a second finish() call is a no-op", () => {
    turnMetrics.startTurn("s3");
    turnMetrics.mark("s3", "sttStart");
    turnMetrics.finish("s3");

    const second = turnMetrics.finish("s3");
    expect(second).toBeNull();
  });

  test("responseId increments per session across turns", () => {
    turnMetrics.startTurn("s4");
    turnMetrics.finish("s4");
    const second = turnMetrics.startTurn("s4");
    expect(second.responseId).toBe("s4:2");
  });

  test("only ever logs labels/timestamps, never arbitrary content — mark() takes no content argument", () => {
    // Structural guarantee, not a string-matching heuristic: mark(sessionId, label)
    // has no third parameter for candidate text/audio to flow through in the
    // first place, so finish()'s record can only ever contain what was built
    // from marks (label + timestamps).
    turnMetrics.startTurn("s5");
    turnMetrics.mark("s5", "sttEnd", "this argument does not exist in the real API");
    const record = turnMetrics.finish("s5");

    expect(record.marks).toEqual([{ label: "sttEnd", offsetMs: expect.any(Number), deltaMs: expect.any(Number) }]);
  });
});
