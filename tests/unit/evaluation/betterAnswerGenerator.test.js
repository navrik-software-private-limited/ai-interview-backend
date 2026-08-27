jest.mock("../../../interviewer/llmClient");
jest.mock("../../../evaluation/evaluationRepository");

const llmClient = require("../../../interviewer/llmClient");
const evaluationRepository = require("../../../evaluation/evaluationRepository");
const { generateBetterAnswers, SCORE_THRESHOLD } = require("../../../evaluation/betterAnswerGenerator");

describe("evaluation/betterAnswerGenerator", () => {
  beforeEach(() => jest.clearAllMocks());

  test("SCORE_THRESHOLD is 7 (docFiles/L3-04 §2 cost-saving filter)", () => {
    expect(SCORE_THRESHOLD).toBe(7);
  });

  test("only generates a better answer for questions scoring below the threshold", async () => {
    llmClient.generateJson.mockResolvedValue({ betterAnswer: "An improved answer." });

    const questionEvaluations = [
      { id: "e1", section: "JD_RESUME", questionText: "Q1", answerText: "A1", score: 9 },
      { id: "e2", section: "JD_RESUME", questionText: "Q2", answerText: "A2", score: 4 },
      { id: "e3", section: "JD_RESUME", questionText: "Q3", answerText: "A3", score: 6.9 },
    ];

    const results = await generateBetterAnswers(questionEvaluations);

    expect(llmClient.generateJson).toHaveBeenCalledTimes(2); // e2 and e3 only
    expect(results.map((r) => r.questionEvaluationId)).toEqual(["e2", "e3"]);
    expect(evaluationRepository.updateBetterAnswer).toHaveBeenCalledWith("e2", "An improved answer.");
    expect(evaluationRepository.updateBetterAnswer).toHaveBeenCalledWith("e3", "An improved answer.");
  });

  test("skips a question with no numeric score entirely", async () => {
    const questionEvaluations = [{ id: "e1", section: "JD_RESUME", questionText: "Q1", score: null }];
    const results = await generateBetterAnswers(questionEvaluations);
    expect(results).toEqual([]);
    expect(llmClient.generateJson).not.toHaveBeenCalled();
  });

  test("skips persisting when the LLM returns no usable betterAnswer", async () => {
    llmClient.generateJson.mockResolvedValue({ somethingElse: true });
    const questionEvaluations = [{ id: "e1", section: "JD_RESUME", questionText: "Q1", score: 3 }];

    const results = await generateBetterAnswers(questionEvaluations);

    expect(results).toEqual([]);
    expect(evaluationRepository.updateBetterAnswer).not.toHaveBeenCalled();
  });

  test("returns [] for an empty question list", async () => {
    const results = await generateBetterAnswers([]);
    expect(results).toEqual([]);
    expect(llmClient.generateJson).not.toHaveBeenCalled();
  });
});
