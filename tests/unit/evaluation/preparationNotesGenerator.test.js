jest.mock("../../../interviewer/llmClient");
const llmClient = require("../../../interviewer/llmClient");
const { generatePreparationNotes } = require("../../../evaluation/preparationNotesGenerator");

describe("evaluation/preparationNotesGenerator", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns [] immediately (no LLM call) when there are no weaknesses", async () => {
    const result = await generatePreparationNotes([]);
    expect(result).toEqual([]);
    expect(llmClient.generateJson).not.toHaveBeenCalled();
  });

  test("keeps a note whose linkedWeakness matches one of the identified weaknesses", async () => {
    const weaknesses = ["Database indexing knowledge needs revision"];
    llmClient.generateJson.mockResolvedValue({
      notes: [
        {
          recommendation: "Review B-tree and hash index trade-offs",
          linkedWeakness: "Database indexing knowledge needs revision",
        },
      ],
    });

    const result = await generatePreparationNotes(weaknesses);

    expect(result).toHaveLength(1);
    expect(result[0].recommendation).toBe("Review B-tree and hash index trade-offs");
  });

  test("drops a note whose linkedWeakness cannot be grounded in any real weakness (docFiles/L3-05 §2)", async () => {
    const weaknesses = ["Database indexing knowledge needs revision"];
    llmClient.generateJson.mockResolvedValue({
      notes: [
        {
          recommendation: "Generic unrelated advice",
          linkedWeakness: "Something about an unrelated communication topic entirely",
        },
      ],
    });

    const result = await generatePreparationNotes(weaknesses);

    expect(result).toEqual([]);
  });

  test("drops a note missing recommendation or linkedWeakness entirely", async () => {
    llmClient.generateJson.mockResolvedValue({
      notes: [{ recommendation: "No link field" }, { linkedWeakness: "No recommendation field" }],
    });

    const result = await generatePreparationNotes(["Some weakness"]);

    expect(result).toEqual([]);
  });

  test("handles a non-compliant (null) LLM response without throwing", async () => {
    llmClient.generateJson.mockResolvedValue(null);
    const result = await generatePreparationNotes(["Some weakness"]);
    expect(result).toEqual([]);
  });
});
