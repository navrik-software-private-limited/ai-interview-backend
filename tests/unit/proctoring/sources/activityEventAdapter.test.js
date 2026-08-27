// Must come before automocking proctoringService below: introspecting the
// real proctoringService.js pulls in ./scoreTracker -> config/redis.js,
// which opens a REAL ioredis connection as a module-load side effect.
jest.mock("../../../../config/redis", () => require("../../../helpers/mockRedis").createMockRedisClient());
jest.mock("../../../../proctoring/proctoringService");
const proctoringService = require("../../../../proctoring/proctoringService");
const { forwardActivityEvent } = require("../../../../proctoring/sources/activityEventAdapter");

describe("proctoring/sources/activityEventAdapter", () => {
  beforeEach(() => jest.clearAllMocks());

  test("hardcodes source and forwards the rest to proctoringService.recordEvent", async () => {
    proctoringService.recordEvent.mockResolvedValue("WARNING");
    const io = {};

    await forwardActivityEvent(io, "s1", { eventType: "TAB_HIDDEN", severity: "WARNING", durationMs: 4200 });

    expect(proctoringService.recordEvent).toHaveBeenCalledWith(io, "s1", {
      source: "activity-monitor",
      eventType: "TAB_HIDDEN",
      severity: "WARNING",
      durationMs: 4200,
      metadata: null,
    });
  });
});
