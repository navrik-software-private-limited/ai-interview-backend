jest.mock("../../../proctoring/sources/activityEventAdapter");
const { forwardActivityEvent } = require("../../../proctoring/sources/activityEventAdapter");
const { handleActivityEvent } = require("../../../proctoring/activityMonitorService");

describe("proctoring/activityMonitorService", () => {
  beforeEach(() => jest.clearAllMocks());

  test("TAB_HIDDEN is classified WARNING", async () => {
    await handleActivityEvent({}, "s1", { eventType: "TAB_HIDDEN" });
    expect(forwardActivityEvent).toHaveBeenCalledWith({}, "s1", {
      eventType: "TAB_HIDDEN",
      severity: "WARNING",
      durationMs: null,
    });
  });

  test("TAB_VISIBLE (the recovery signal) is classified INFORMATIONAL, never adding to the score penalty", async () => {
    await handleActivityEvent({}, "s1", { eventType: "TAB_VISIBLE", durationSeconds: 12.5 });
    expect(forwardActivityEvent).toHaveBeenCalledWith({}, "s1", {
      eventType: "TAB_VISIBLE",
      severity: "INFORMATIONAL",
      durationMs: 12500,
    });
  });

  test("an unknown eventType is dropped without forwarding", async () => {
    await handleActivityEvent({}, "s1", { eventType: "SOMETHING_ELSE" });
    expect(forwardActivityEvent).not.toHaveBeenCalled();
  });

  test("a missing eventType is dropped without throwing", async () => {
    await expect(handleActivityEvent({}, "s1", {})).resolves.toBeUndefined();
    expect(forwardActivityEvent).not.toHaveBeenCalled();
  });
});
