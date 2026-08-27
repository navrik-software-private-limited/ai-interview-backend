// Must come before automocking proctoringService below: introspecting the
// real proctoringService.js pulls in ./scoreTracker -> config/redis.js,
// which opens a REAL ioredis connection as a module-load side effect.
jest.mock("../../../../config/redis", () => require("../../../helpers/mockRedis").createMockRedisClient());
jest.mock("../../../../proctoring/proctoringService");
const proctoringService = require("../../../../proctoring/proctoringService");
const { forwardCodingEvent } = require("../../../../proctoring/sources/codingEventAdapter");

describe("proctoring/sources/codingEventAdapter", () => {
  beforeEach(() => jest.clearAllMocks());

  test("hardcodes source and forwards the rest to proctoringService.recordEvent", async () => {
    proctoringService.recordEvent.mockResolvedValue("SUSPICIOUS");
    const io = {};

    await forwardCodingEvent(io, "s1", {
      eventType: "PASTE_DETECTED",
      severity: "SUSPICIOUS",
      metadata: { charCount: 300 },
    });

    expect(proctoringService.recordEvent).toHaveBeenCalledWith(io, "s1", {
      source: "coding-environment",
      eventType: "PASTE_DETECTED",
      severity: "SUSPICIOUS",
      metadata: { charCount: 300 },
    });
  });
});
