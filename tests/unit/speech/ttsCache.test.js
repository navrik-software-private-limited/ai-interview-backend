jest.mock("../../../speech/ttsClient");
const ttsClient = require("../../../speech/ttsClient");
const ttsCache = require("../../../speech/ttsCache");

describe("speech/ttsCache.getOrSynthesize", () => {
  beforeEach(() => jest.clearAllMocks());

  test("forwards signal to ttsClient.synthesizeSpeech on a cache miss", async () => {
    ttsClient.synthesizeSpeech.mockResolvedValue(Buffer.alloc(10));
    const signal = new AbortController().signal;

    await ttsCache.getOrSynthesize(`unique text ${Math.random()}`, { signal });

    expect(ttsClient.synthesizeSpeech).toHaveBeenCalledWith(expect.any(String), { signal });
  });

  test("a cache hit never touches ttsClient at all, signal or not", async () => {
    const text = `cached text ${Math.random()}`;
    ttsClient.synthesizeSpeech.mockResolvedValue(Buffer.alloc(10));
    await ttsCache.getOrSynthesize(text);
    ttsClient.synthesizeSpeech.mockClear();

    await ttsCache.getOrSynthesize(text, { signal: new AbortController().signal });

    expect(ttsClient.synthesizeSpeech).not.toHaveBeenCalled();
  });
});
