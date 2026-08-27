// interviewer/llmClient.js is a single chokepoint (`generateReply`,
// `generateJson`) used by 13 modules in this repo. `jest.mock(...)` calls
// must be written directly in each test file to get hoisted correctly
// (Jest hoists literal `jest.mock` calls, not calls made through an
// imported helper) — automocking it there replaces both exports with
// `jest.fn()`, which already support `.mockResolvedValue(...)`.
//
// This helper only provides shared fixture builders for what those mocks
// should return, so tests aren't hand-rolling the same JSON shapes.
//
// Usage in a test file:
//   jest.mock("../../interviewer/llmClient");
//   const llmClient = require("../../interviewer/llmClient");
//   const { jsonFixture } = require("../helpers/mockLlmClient");
//   llmClient.generateJson.mockResolvedValue(jsonFixture({ followUp: false, reason: "ok" }));

function jsonFixture(shape = {}) {
  return { ...shape };
}

module.exports = { jsonFixture };
