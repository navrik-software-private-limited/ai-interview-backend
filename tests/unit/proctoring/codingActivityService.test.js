jest.mock("../../../proctoring/sources/codingEventAdapter");
const { forwardCodingEvent } = require("../../../proctoring/sources/codingEventAdapter");
const { handlePasteEvent, IGNORE_BELOW_CHARS, SUSPICIOUS_AT_CHARS } = require("../../../proctoring/codingActivityService");

describe("proctoring/codingActivityService", () => {
  beforeEach(() => jest.clearAllMocks());

  test("a trivially small paste is ignored entirely", async () => {
    await handlePasteEvent({}, "s1", { charCount: IGNORE_BELOW_CHARS - 1 });
    expect(forwardCodingEvent).not.toHaveBeenCalled();
  });

  test("a moderate paste is classified WARNING", async () => {
    await handlePasteEvent({}, "s1", { charCount: IGNORE_BELOW_CHARS });
    expect(forwardCodingEvent).toHaveBeenCalledWith({}, "s1", {
      eventType: "PASTE_DETECTED",
      severity: "WARNING",
      metadata: { charCount: IGNORE_BELOW_CHARS },
    });
  });

  test("a large paste is classified SUSPICIOUS", async () => {
    await handlePasteEvent({}, "s1", { charCount: SUSPICIOUS_AT_CHARS });
    expect(forwardCodingEvent).toHaveBeenCalledWith({}, "s1", {
      eventType: "PASTE_DETECTED",
      severity: "SUSPICIOUS",
      metadata: { charCount: SUSPICIOUS_AT_CHARS },
    });
  });

  test("a missing/non-numeric charCount is treated as 0 and ignored", async () => {
    await handlePasteEvent({}, "s1", {});
    expect(forwardCodingEvent).not.toHaveBeenCalled();
  });
});
