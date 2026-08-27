const { ChatOpenAI } = require("@langchain/openai");
const { SystemMessage, HumanMessage, AIMessage } = require("@langchain/core/messages");
const env = require("../config/env");

const model = new ChatOpenAI({
  apiKey: env.openai.apiKey,
  model: env.openai.model,
  temperature: 0.6,
});

// Deterministic + JSON-mode variant for structured decisions (e.g. the
// follow-up decider) — separate from the conversational `model` above so
// question/answer generation keeps its natural temperature.
const jsonModel = new ChatOpenAI({
  apiKey: env.openai.apiKey,
  model: env.openai.model,
  temperature: 0,
  modelKwargs: { response_format: { type: "json_object" } },
});

function toLangchainMessage(message) {
  if (message.role === "user") return new HumanMessage(message.content);
  return new AIMessage(message.content);
}

// doc/real_time_interview_communication_improvement.md Phase 9 (§19 "LLM
// timeout": "do not leave the interviewer stuck in AI_THINKING"). A hung
// OpenAI request previously had no bound at all — this races it against a
// timer and rejects with a plain Error, deliberately NOT an AbortError/
// signal.aborted — every caller up the chain already distinguishes "genuine
// failure" (fall back) from "deliberate barge-in cancellation" (rethrow,
// don't fall back) via signal?.aborted, and a timeout must be treated as the
// former, falling through the exact same fallback tiers a normal LLM error
// already does.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// doc/real_time_interview_communication_improvement.md Phase 3 (barge-in):
// signal is optional and forwarded straight to LangChain's own abort support
// (model.invoke(messages, {signal})) — callers that don't pass one (e.g.
// nothing changes for a caller that predates this) behave exactly as before.
async function generateReply(history, systemPrompt, { signal } = {}) {
  const messages = [new SystemMessage(systemPrompt), ...history.map(toLangchainMessage)];
  const response = await withTimeout(model.invoke(messages, { signal }), env.openai.requestTimeoutMs, "generateReply");
  return typeof response.content === "string" ? response.content : String(response.content);
}

// doc/real_time_interview_communication_improvement.md Phase 6: sibling of
// generateReply above, not a replacement — returns LangChain's own async
// iterable of chunks (each with a .content string delta) instead of
// awaiting the full response. Same AbortSignal support. Callers accumulate
// chunk.content themselves (see interviewController.js's speakGenerated).
async function generateReplyStream(history, systemPrompt, { signal } = {}) {
  const messages = [new SystemMessage(systemPrompt), ...history.map(toLangchainMessage)];
  // Only the initial connect is bounded here — per-chunk stalls once the
  // stream is flowing are guarded by the consumer (interviewController.js's
  // speakGenerated), which has the turn/session context this function doesn't.
  const stream = await withTimeout(model.stream(messages, { signal }), env.openai.requestTimeoutMs, "generateReplyStream");
  return stream;
}

// Single-shot structured call — prompt must instruct the model to return
// JSON. Returns null (never throws) if the model doesn't comply, so callers
// can fall back to a safe default. A deliberate abort (signal.aborted) is
// rethrown rather than swallowed into null — the caller needs to be able to
// tell "the model returned garbage" apart from "this was cancelled" (see
// interviewController.js's speak(), which must not treat a cancellation as
// a normal failure to fall back from).
async function generateJson(prompt, { signal } = {}) {
  try {
    const response = await withTimeout(
      jsonModel.invoke([new SystemMessage(prompt)], { signal }),
      env.openai.requestTimeoutMs,
      "generateJson"
    );
    const text = typeof response.content === "string" ? response.content : String(response.content);
    return JSON.parse(text);
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
}

module.exports = { generateReply, generateReplyStream, generateJson };
