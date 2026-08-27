// Shared fake for the raw ioredis client `config/redis.js` exports directly
// (no wrapper layer exists in this repo). Backed by an in-memory Map so
// session/sessionStore.js's get-modify-set pattern behaves like real Redis
// within a single test.
//
// Usage in a test file:
//   jest.mock("../../config/redis", () => require("../helpers/mockRedis").createMockRedisClient());

function createMockRedisClient() {
  const store = new Map();

  return {
    get: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key, value) => {
      store.set(key, value);
      return "OK";
    }),
    del: jest.fn(async (key) => (store.delete(key) ? 1 : 0)),
    incr: jest.fn(async (key) => {
      const next = (Number(store.get(key)) || 0) + 1;
      store.set(key, String(next));
      return next;
    }),
    hset: jest.fn(async () => 1),
    hgetall: jest.fn(async () => ({})),
    expire: jest.fn(async () => 1),
    // Exposed for tests that want to assert on raw stored state directly.
    _store: store,
  };
}

module.exports = { createMockRedisClient };
