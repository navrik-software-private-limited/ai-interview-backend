const Redis = require("ioredis");
const env = require("./env");

// Own client, own key prefix — points at the same Redis server practywiz-backend
// uses for its BullMQ email queue, but never touches the queue's keys.
const redis = new Redis({
  host: env.redis.host,
  port: env.redis.port,
  password: env.redis.password,
  tls: env.redis.tls,
  keyPrefix: env.redis.keyPrefix,
  maxRetriesPerRequest: null,
});

redis.on("connect", () => console.log("✔ [ai-interview-backend] Redis connected"));
redis.on("error", (err) => console.error("✖ [ai-interview-backend] Redis error", err.message));

module.exports = redis;
