// Must come before automocking proctoringService below: introspecting the
// real proctoringService.js pulls in ./scoreTracker -> config/redis.js,
// which opens a REAL ioredis connection as a module-load side effect.
jest.mock("../../../../config/redis", () => require("../../../helpers/mockRedis").createMockRedisClient());
jest.mock("../../../../proctoring/proctoringService");
const proctoringService = require("../../../../proctoring/proctoringService");
const { forwardConnectivityEvent } = require("../../../../proctoring/sources/connectivityEventAdapter");

describe("proctoring/sources/connectivityEventAdapter", () => {
  beforeEach(() => jest.clearAllMocks());

  test("hardcodes source and forwards the rest to proctoringService.recordEvent", async () => {
    proctoringService.recordEvent.mockResolvedValue("WARNING");
    const io = {};

    const result = await forwardConnectivityEvent(io, "s1", {
      eventType: "MEDIA_DEGRADED",
      severity: "WARNING",
      metadata: { reason: "transport close" },
    });

    expect(proctoringService.recordEvent).toHaveBeenCalledWith(io, "s1", {
      source: "connectivity-monitor",
      eventType: "MEDIA_DEGRADED",
      severity: "WARNING",
      metadata: { reason: "transport close" },
    });
    expect(result).toBe("WARNING");
  });

  test("defaults metadata to null when omitted", async () => {
    proctoringService.recordEvent.mockResolvedValue("CRITICAL");
    await forwardConnectivityEvent({}, "s1", { eventType: "MEDIA_FAILED", severity: "CRITICAL" });
    expect(proctoringService.recordEvent).toHaveBeenCalledWith(
      {},
      "s1",
      expect.objectContaining({ metadata: null })
    );
  });
});
