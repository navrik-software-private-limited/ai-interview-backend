const { extractCompleteSentences } = require("../../../interviewer/sentenceChunker");

describe("interviewer/sentenceChunker.extractCompleteSentences", () => {
  test("extracts one complete sentence, leaving nothing in remainder", () => {
    const result = extractCompleteSentences("Tell me about your last project. ");
    expect(result.sentences).toEqual(["Tell me about your last project."]);
    expect(result.remainder).toBe("");
  });

  test("an in-progress sentence with no terminal punctuation yet stays entirely in remainder", () => {
    const result = extractCompleteSentences("Tell me about your last");
    expect(result.sentences).toEqual([]);
    expect(result.remainder).toBe("Tell me about your last");
  });

  test("a period at the very end of the buffer (nothing after it yet) is not treated as complete", () => {
    const result = extractCompleteSentences("Tell me about your last project.");
    expect(result.sentences).toEqual([]);
    expect(result.remainder).toBe("Tell me about your last project.");
  });

  test("extracts multiple complete sentences from one buffer, keeping the trailing partial one in remainder", () => {
    const result = extractCompleteSentences("First sentence here. Second one too! Now starting a third");
    expect(result.sentences).toEqual(["First sentence here.", "Second one too!"]);
    expect(result.remainder).toBe("Now starting a third");
  });

  test("does not split a decimal number", () => {
    const result = extractCompleteSentences("The rate is 3.14 percent, which matters a lot. ");
    expect(result.sentences).toEqual(["The rate is 3.14 percent, which matters a lot."]);
  });

  test("does not split on a common abbreviation", () => {
    const result = extractCompleteSentences("Mr. Smith led the project and it went well. ");
    expect(result.sentences).toEqual(["Mr. Smith led the project and it went well."]);
  });

  test("does not split a very short fragment even with trailing punctuation and whitespace", () => {
    const result = extractCompleteSentences("Ok. Well, that makes sense given the constraints. ");
    // "Ok." alone is under MIN_SENTENCE_LENGTH, so it merges into the next sentence instead of becoming its own tiny fragment
    expect(result.sentences).toEqual(["Ok. Well, that makes sense given the constraints."]);
  });

  test("handles a question and an exclamation, not just periods", () => {
    const result = extractCompleteSentences("Can you walk me through that? Great, thanks! ");
    expect(result.sentences).toEqual(["Can you walk me through that?", "Great, thanks!"]);
  });

  test("empty buffer produces no sentences and an empty remainder", () => {
    const result = extractCompleteSentences("");
    expect(result).toEqual({ sentences: [], remainder: "" });
  });

  test("simulates incremental streaming: feeding the remainder back in as more text arrives", () => {
    let buffer = "";
    const deltas = ["Tell me ", "about your ", "last project. ", "What was the ", "biggest challenge?"];
    const allSentences = [];

    for (const delta of deltas) {
      buffer += delta;
      const { sentences, remainder } = extractCompleteSentences(buffer);
      allSentences.push(...sentences);
      buffer = remainder;
    }

    expect(allSentences).toEqual(["Tell me about your last project."]);
    expect(buffer).toBe("What was the biggest challenge?"); // trailing sentence, flushed by the caller once the stream ends
  });
});
