import { describe, expect, it, vi } from "vitest";
import { createSmartRetry, isOpenRouterGemini, isTextRejection, runSmartRetry, splitRetryText } from "../../src/server/smartRetry.js";

const rejection = () => Object.assign(new Error("Provider returned 400"), { status: 400 });
const flatten = (text) => {
  const parts = splitRetryText(text);
  return parts ? parts.flatMap(flatten) : [text];
};

describe("smart retry splitting", () => {
  it.each([
    "First sentence ends here. Second sentence starts here.",
    "Hello, ‘beautiful world’!  A new\nparagraph follows.",
    "你好，世界。今天是美好的一天。", "مرحبا بالعالم، كيف حالك؟", "हिन्दी में यह एक वाक्य है।",
    "Cafe\u0301 👨‍👩‍👧‍👦 says hello!", "Don't split contractions or e\u0301lan."
  ])("preserves every character and grapheme: %s", (text) => {
    const leaves = flatten(text);
    expect(leaves.join("")).toBe(text);
    expect(flatten(text)).toEqual(leaves);
    const boundaries = new Set([...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((part) => part.index));
    let offset = 0;
    for (const leaf of leaves) {
      expect(boundaries.has(offset)).toBe(true);
      expect(leaf.trim()).not.toBe("");
      offset += leaf.length;
    }
  });

  it("prefers central sentence boundaries, then clauses", () => {
    expect(splitRetryText("First sentence ends here. Second sentence starts here."))
      .toEqual(["First sentence ends here. ", "Second sentence starts here."]);
    expect(splitRetryText("one two three; four five six seven"))
      .toEqual(["one two three; ", "four five six seven"]);
  });

  it("does not split a single word, contraction, or grapheme", () => {
    for (const text of ["“Word!”", "don't", "e\u0301lan", "👨‍👩‍👧‍👦", "x".repeat(300), ""]) expect(splitRetryText(text)).toBeNull();
    expect(flatten("Hello, ‘beautiful world’!" )).toEqual(["Hello, ", "‘beautiful ", "world’!"]);
  });
});

describe("smart retry eligibility", () => {
  it("only accepts OpenRouter Gemini model IDs", () => {
    expect(isOpenRouterGemini({ provider: "openrouter", model: "google/gemini-3.1-flash-tts-preview" })).toBe(true);
    expect(isOpenRouterGemini({ provider: "openrouter", model: "google/gemini-2.5-pro-preview-tts" })).toBe(true);
    for (const provider of ["google", "gemini", "xai"]) expect(isOpenRouterGemini({ provider, model: "gemini-3.1" })).toBe(false);
    expect(isOpenRouterGemini({ provider: "openrouter", model: "openai/tts-1" })).toBe(false);
  });

  it("recognizes generic 400 and explicit content rejection", () => {
    expect(isTextRejection(rejection())).toBe(true);
    expect(isTextRejection({ status: 403, errorType: "content_policy_violation" })).toBe(true);
    expect(isTextRejection({ status: 422, message: "Blocked by safety filter" })).toBe(true);
  });

  it.each([
    { status: 401 }, { status: 402 }, { status: 403 }, { status: 404 }, { status: 429 }, { status: 503 },
    { status: 400, errorType: "rate_limit_exceeded" }, { status: 400, providerCode: "RESOURCE_EXHAUSTED" },
    { status: 400, errorType: "invalid_request" }, { status: 400, message: "Voice is not supported" },
    { status: 400, message: "Invalid API key" }, { status: 400, message: "Insufficient credits" },
    { status: 400, message: "Provider temporarily unavailable" }, { status: 400, message: "Request timed out" },
    { status: 400, message: "Unauthorized" }, { status: 400, message: "Invalid JSON" },
    { message: "fetch failed" }, { name: "AbortError" }
  ])("does not split operational errors: %j", (error) => expect(isTextRejection(error)).toBe(false));
});

describe("smart retry worker", () => {
  it("splits only failed branches, keeps successes ordered, and omits rejected words", async () => {
    const state = createSmartRetry("alpha beta gamma delta");
    const synthesize = vi.fn(async (piece) => {
      if (piece.text.includes("gamma")) throw rejection();
      return Buffer.from(piece.text);
    });
    const onProgress = vi.fn();
    expect(await runSmartRetry(state, { synthesize, onProgress, index: 16, signal: new AbortController().signal })).toBe(true);
    expect(synthesize.mock.calls.map(([piece]) => piece.text)).toEqual(["alpha beta ", "gamma delta", "gamma ", "delta"]);
    expect(Buffer.concat(state.audio).toString()).toBe("alpha beta delta");
    expect(state.omissions).toEqual([{ index: 16, text: "gamma " }]);
    expect(onProgress).toHaveBeenLastCalledWith({ attempts: 4, attemptLimit: 64, resolvedPieces: 2, skippedPieces: 1 });
  });

  it("checkpoints after 64 attempts and resumes without repeating successful pieces", async () => {
    const text = Array.from({ length: 100 }, (_, index) => `word${index}`).join(" ");
    const state = createSmartRetry(text);
    const accepted = [];
    const synthesize = vi.fn(async (piece) => {
      if (splitRetryText(piece.text)) throw rejection();
      accepted.push(piece.text);
      return Buffer.from(piece.text);
    });
    const options = { synthesize, index: 1, signal: new AbortController().signal };
    expect(await runSmartRetry(state, options)).toBe(false);
    expect(synthesize).toHaveBeenCalledTimes(64);
    expect(state.audio.length).toBeGreaterThan(0);
    let batches = 1;
    while (!(await runSmartRetry(state, options))) {
      batches += 1;
      expect(batches).toBeLessThan(10);
    }
    expect(accepted).toHaveLength(100);
    expect(new Set(accepted).size).toBe(100);
    expect(Buffer.concat(state.audio).toString()).toBe(text);
  });

  it("keeps the current piece on operational failure without an omission", async () => {
    const state = createSmartRetry("alpha beta");
    const pending = [...state.pending];
    const error = Object.assign(new Error("Rate limit"), { status: 429 });
    await expect(runSmartRetry(state, { index: 1, signal: new AbortController().signal, synthesize: async () => { throw error; } })).rejects.toBe(error);
    expect(state.pending).toEqual(pending);
    expect(state.omissions).toEqual([]);
  });

  it("discards a late result after cancellation", async () => {
    const state = createSmartRetry("alpha beta");
    const controller = new AbortController();
    const synthesize = vi.fn(async () => { controller.abort(); return Buffer.from([1, 0]); });
    await expect(runSmartRetry(state, { index: 1, signal: controller.signal, synthesize })).rejects.toMatchObject({ name: "AbortError" });
    expect(state.audio).toEqual([]);
    expect(state.pending).toHaveLength(2);
    expect(synthesize).toHaveBeenCalledTimes(1);
  });
});
