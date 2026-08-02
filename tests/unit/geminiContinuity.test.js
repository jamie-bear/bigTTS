import { describe, expect, it, vi } from "vitest";
import {
  OPENROUTER_GEMINI_31_TTS_MODEL,
  buildGemini31NarrationPrompt,
  createGeminiNarrationSegments,
  geminiPaceDirective,
  isOpenRouterGemini31Model,
  prepareGeminiTranscript,
  requestOpenRouterGemini31Speech,
  sanitizeNarratorDirection
} from "../../src/server/geminiContinuity.js";
import { openRouterErrorDetails } from "../../src/server/openRouterSpeech.js";

describe("OpenRouter Gemini 3.1 continuity", () => {
  it("activates only for the exact model identifier", () => {
    expect(isOpenRouterGemini31Model(OPENROUTER_GEMINI_31_TTS_MODEL)).toBe(true);
    expect(isOpenRouterGemini31Model(`  ${OPENROUTER_GEMINI_31_TTS_MODEL.toUpperCase()}  `)).toBe(true);
    expect(isOpenRouterGemini31Model("google/gemini-tts")).toBe(false);
    expect(isOpenRouterGemini31Model("google/gemini-3.1-flash")).toBe(false);
  });

  it("preserves source separators instead of inventing paragraph breaks", () => {
    const text = "First sentence stays here. Second sentence follows normally. Third sentence closes the thought.";
    const segments = createGeminiNarrationSegments(text, { targetChars: 45, hardMaxChars: 80 });
    expect(segments.map(({ text: segmentText }) => segmentText).join("")).toBe(text);
    expect(segments.every(({ text: segmentText }) => !segmentText.includes("\n\n"))).toBe(true);
  });

  it("preserves multilingual text and Unicode punctuation", () => {
    const sample = "Er ging nach Hause. Warum so früh?\n\n彼は帰った。次の日、戻った！\n\nمرحبا بالعالم. كيف حالك؟";
    const text = Array.from({ length: 8 }, () => sample).join("\n\n");
    const segments = createGeminiNarrationSegments(text, { targetChars: 300, hardMaxChars: 500 });
    expect(segments.map(({ text: segmentText }) => segmentText).join("")).toBe(text);
    expect(segments.length).toBeGreaterThan(1);
  });

  it("enforces the hard cap by preferring clause boundaries", () => {
    const clause = "a measured clause with several words, ";
    const text = `${clause.repeat(100)}and the sentence finally ends.`;
    const segments = createGeminiNarrationSegments(text, { targetChars: 900, hardMaxChars: 1000 });
    expect(segments.map(({ text: segmentText }) => segmentText).join("")).toBe(text);
    expect(Math.max(...segments.map(({ text: segmentText }) => segmentText.length))).toBeLessThanOrEqual(1000);
    expect(segments.slice(0, -1).every(({ text: segmentText }) => /[,\s]$/u.test(segmentText))).toBe(true);
  });

  it("keeps continuity context out of chapter transitions", () => {
    const body = "A complete sentence establishes the scene. Another sentence carries the narration forward. ";
    const text = `Chapter One\n\n${body.repeat(6)}\n\nChapter Two\n\n${body.repeat(6)}`;
    const segments = createGeminiNarrationSegments(text, { targetChars: 260, hardMaxChars: 500 });
    const chapterStart = segments.find((segment, index) => index > 0 && segment.boundaryBefore === "chapter");
    expect(chapterStart).toBeDefined();
    expect(chapterStart?.previousContext).toBe("");
    expect(segments.map(({ text: segmentText }) => segmentText).join("")).toBe(text);
  });

  it("attaches real headings without treating ordinary short prose as a chapter", () => {
    const body = "A complete sentence establishes the scene. Another sentence carries it onward. ".repeat(8);
    const headingSegments = createGeminiNarrationSegments(`The Long Road Home\n\n${body}`, { targetChars: 300, hardMaxChars: 500 });
    expect(headingSegments[0].text).toMatch(/^The Long Road Home\n\nA complete sentence/u);
    const proseSegments = createGeminiNarrationSegments(`${body}\n\nMara looked down\n\n${body}`, { targetChars: 300, hardMaxChars: 500 });
    expect(proseSegments.some((segment, index) => index > 0 && segment.boundaryBefore === "chapter" && segment.text.startsWith("Mara looked down"))).toBe(false);
  });

  it("never sends a scene marker as a punctuation-only synthesis segment", () => {
    const body = "A complete sentence establishes the scene. Another sentence carries it onward. ".repeat(8);
    const text = `${body}\n\n* * *\n\n${body}`;
    const segments = createGeminiNarrationSegments(text, { targetChars: 300, hardMaxChars: 500 });
    expect(segments.map(({ text: segmentText }) => segmentText).join("")).toBe(text);
    expect(segments.every(({ text: segmentText }) => textContent(segmentText))).toBe(true);
    const sceneBoundary = segments.findIndex((segment) => segment.boundaryAfter === "scene");
    expect(sceneBoundary).toBeGreaterThanOrEqual(0);
    expect(segments[sceneBoundary + 1]?.boundaryBefore).toBe("scene");
    expect(segments[sceneBoundary + 1]?.previousContext).toBe("");
  });

  it("merges a short pre-scene tail and keeps Markdown structure out of the provider transcript", () => {
    const lead = "A complete sentence carries the narration forward with enough detail to establish a stable delivery. ".repeat(6);
    const text = `## 2:04 P.M.\n\n${lead}\n\n"A short exchange."\n\n---\n\n## 2:41 P.M.\n\nThe next scene begins.`;
    const segments = createGeminiNarrationSegments(text, { targetChars: 500, hardMaxChars: 1000 });
    const sceneEnd = segments.find((segment) => segment.boundaryAfter === "scene");

    expect(sceneEnd?.text).toContain("A short exchange.");
    expect(sceneEnd?.text.length).toBeGreaterThanOrEqual(325);
    expect(prepareGeminiTranscript("## 2:04 P.M.\n\nDialogue.\n\n---\n\n"))
      .toBe("2:04 P.M.\n\nDialogue.");

    const prompt = buildGemini31NarrationPrompt(sceneEnd, { speed: 1, enhancedContinuity: true });
    const transcript = prompt.slice(prompt.indexOf("# TRANSCRIPT\n") + "# TRANSCRIPT\n".length);
    expect(transcript).not.toContain("##");
    expect(transcript).not.toContain("---");
    expect(transcript).toContain("2:04 P.M.");
    expect(transcript).toContain("A short exchange.");
  });

  it("builds stable direction with silent context and exact transcript text", () => {
    const segment = {
      text: "[whispers] This text must remain unchanged.",
      previousContext: "The prior sentence.",
      nextContext: "The following sentence.",
      boundaryBefore: "sentence",
      boundaryAfter: "paragraph"
    };
    const prompt = buildGemini31NarrationPrompt(segment, {
      speed: 1,
      enhancedContinuity: true,
      narratorDirection: "  Warm   and intimate.\n\n\nKeep it restrained.  "
    });
    expect(prompt).toContain("Previous: The prior sentence.");
    expect(prompt).toContain("Following: The following sentence.");
    expect(prompt).toContain("Additional narrator direction: Warm and intimate.\n\nKeep it restrained.");
    expect(prompt.slice(prompt.indexOf("# TRANSCRIPT") + "# TRANSCRIPT\n".length)).toBe(segment.text);
    expect(prompt.match(/\[whispers\]/g)).toHaveLength(1);
  });

  it("omits neighboring context when enhanced continuity is disabled", () => {
    const prompt = buildGemini31NarrationPrompt({
      text: "Only this is spoken.", previousContext: "Previous.", nextContext: "Next.", boundaryBefore: "sentence", boundaryAfter: "sentence"
    }, { enhancedContinuity: false, speed: 1 });
    expect(prompt).toContain("Previous: none\nFollowing: none");
    expect(prompt).not.toContain("Previous.");
  });

  it("uses document cadence only at true outer boundaries", () => {
    const base = { text: "A passage.", previousContext: "", nextContext: "" };
    const outer = buildGemini31NarrationPrompt({ ...base, boundaryBefore: "start", boundaryAfter: "end" }, { speed: 1 });
    const internal = buildGemini31NarrationPrompt({ ...base, boundaryBefore: "sentence", boundaryAfter: "sentence" }, { speed: 1 });
    expect(outer).toContain("natural opening or closing cadence");
    expect(internal).toContain("continuous performance");
  });

  it("uses stable pace bands and sanitizes custom direction", () => {
    expect(geminiPaceDirective(0.82)).toContain("115");
    expect(geminiPaceDirective(0.83)).toContain("135");
    expect(geminiPaceDirective(0.95)).toContain("155");
    expect(geminiPaceDirective(1.07)).toContain("180");
    expect(geminiPaceDirective(1.24)).toContain("205");
    expect(sanitizeNarratorDirection("x".repeat(900))).toHaveLength(800);
  });

  it("requests PCM without speed and retries transient failures", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "temporary" } }), { status: 500, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 0, 1, 0]), { status: 200, headers: { "content-type": "audio/pcm", "x-generation-id": "gen-123" } }));
    const sleep = vi.fn(async () => undefined);
    const result = await requestOpenRouterGemini31Speech({
      url: "https://openrouter.ai/api/v1/audio/speech", apiKey: "test", voice: "Kore", input: "Prompt", fetchImpl, sleep
    });
    const request = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(request).toEqual({ model: OPENROUTER_GEMINI_31_TTS_MODEL, input: "Prompt", voice: "Kore", response_format: "pcm" });
    expect(request).not.toHaveProperty("speed");
    expect(result).toMatchObject({ generationId: "gen-123", attempts: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("rejects non-audio and malformed PCM responses without retrying", async () => {
    const jsonFetch = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    await expect(requestOpenRouterGemini31Speech({ url: "test", apiKey: "test", voice: "Kore", input: "Prompt", fetchImpl: jsonFetch, maxAttempts: 1 })).rejects.toThrow(/non-audio|application\/json/i);
    const oddFetch = vi.fn(async () => new Response(new Uint8Array([0]), { status: 200, headers: { "content-type": "audio/pcm" } }));
    await expect(requestOpenRouterGemini31Speech({ url: "test", apiKey: "test", voice: "Kore", input: "Prompt", fetchImpl: oddFetch, maxAttempts: 1 })).rejects.toThrow(/odd-length/i);
  });

  it("retries rate limits, honors Retry-After, and respects cancellation", async () => {
    const rateLimited = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "rate limited", metadata: { error_type: "rate_limit_exceeded" } } }), { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 0]), { status: 200, headers: { "content-type": "audio/pcm" } }));
    const sleep = vi.fn(async () => undefined);
    await expect(requestOpenRouterGemini31Speech({ url: "test", apiKey: "test", voice: "Kore", input: "Prompt", fetchImpl: rateLimited, sleep })).resolves.toMatchObject({ attempts: 2 });
    expect(rateLimited).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000, undefined);
    const controller = new AbortController();
    controller.abort();
    const neverCalled = vi.fn();
    await expect(requestOpenRouterGemini31Speech({ url: "test", apiKey: "test", voice: "Kore", input: "Prompt", fetchImpl: neverCalled, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it("preserves typed provider diagnostics for non-retryable segment errors", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 400,
        message: "Provider returned 400",
        metadata: {
          error_type: "content_policy_violation",
          provider_code: "PROHIBITED_CONTENT",
          provider_name: "Google AI Studio",
          reasons: ["prompt classifier"],
          flagged_input: "flagged excerpt"
        }
      }
    }), { status: 400, headers: { "x-request-id": "req-123" } }));

    let failure;
    try {
      await requestOpenRouterGemini31Speech({ url: "test", apiKey: "test", voice: "Kore", input: "Prompt", fetchImpl });
    } catch (error) {
      failure = error;
    }

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(openRouterErrorDetails(failure)).toEqual({
      status: 400,
      code: "400",
      errorType: "content_policy_violation",
      providerCode: "PROHIBITED_CONTENT",
      providerName: "Google AI Studio",
      reasons: ["prompt classifier"],
      flaggedInput: "flagged excerpt",
      requestId: "req-123",
      attempts: 1
    });
  });
});

function textContent(value) {
  return /[\p{L}\p{N}]/u.test(value);
}
