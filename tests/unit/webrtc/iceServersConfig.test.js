function loadWithEnv(envOverrides) {
  jest.resetModules();
  jest.doMock("../../../config/env", () => ({
    webrtc: {
      stunUrls: ["stun:stun.l.google.com:19302"],
      turnUrls: [],
      turnUsername: undefined,
      turnCredential: undefined,
      ...envOverrides,
    },
  }));
  return require("../../../webrtc/iceServersConfig");
}

describe("webrtc/iceServersConfig", () => {
  afterEach(() => {
    jest.dontMock("../../../config/env");
  });

  test("returns STUN-only by default (matches the previously hardcoded behavior)", () => {
    const { getIceServers } = loadWithEnv({});
    expect(getIceServers()).toEqual([{ urls: "stun:stun.l.google.com:19302" }]);
  });

  test("supports multiple STUN URLs", () => {
    const { getIceServers } = loadWithEnv({ stunUrls: ["stun:a.example.com", "stun:b.example.com"] });
    expect(getIceServers()).toEqual([{ urls: "stun:a.example.com" }, { urls: "stun:b.example.com" }]);
  });

  test("appends a TURN entry once all three TURN values are configured", () => {
    const { getIceServers } = loadWithEnv({
      turnUrls: ["turn:turn.example.com:3478"],
      turnUsername: "user1",
      turnCredential: "secret1",
    });

    expect(getIceServers()).toEqual([
      { urls: "stun:stun.l.google.com:19302" },
      { urls: ["turn:turn.example.com:3478"], username: "user1", credential: "secret1" },
    ]);
  });

  test.each([
    ["urls only", { turnUrls: ["turn:turn.example.com:3478"] }],
    ["urls + username, no credential", { turnUrls: ["turn:turn.example.com:3478"], turnUsername: "user1" }],
    ["username + credential, no urls", { turnUsername: "user1", turnCredential: "secret1" }],
  ])("treats a partially-configured TURN (%s) as not configured — STUN-only, no broken entry", (_label, overrides) => {
    const { getIceServers } = loadWithEnv(overrides);
    expect(getIceServers()).toEqual([{ urls: "stun:stun.l.google.com:19302" }]);
  });
});
