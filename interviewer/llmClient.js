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

async function generateReply(history, systemPrompt) {
  const messages = [new SystemMessage(systemPrompt), ...history.map(toLangchainMessage)];
  const response = await model.invoke(messages);
  return typeof response.content === "string" ? response.content : String(response.content);
}

// Single-shot structured call — prompt must instruct the model to return
// JSON. Returns null (never throws) if the model doesn't comply, so callers
// can fall back to a safe default.
async function generateJson(prompt) {
  try {
    const response = await jsonModel.invoke([new SystemMessage(prompt)]);
    const text = typeof response.content === "string" ? response.content : String(response.content);
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

module.exports = { generateReply, generateJson };
