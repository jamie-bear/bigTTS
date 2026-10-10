import { afterEach, describe, expect, it, vi } from "vitest";
import { getOpenRouterGeminiCapabilities } from "../../src/shared/geminiModels.js";
import { buildGeminiSpeechBody, createGeminiNarrationSegments, prepareGeminiTranscript, requestOpenRouterGeminiSpeech } from "../../src/server/geminiContinuity.js";
import { createNarrationSession, sanitizeOptions } from "../../src/server.js";

const models = ["google/gemini-3.1-flash-tts-preview", "google/gemini-3.8-flash-tts", "google/gemini-3.8-flash-lite-tts"];
const segment = { text: "## Chapter One\n\n*The passage.* <sigh>", previousContext: "Secret previous excerpt.", nextContext: "Secret following excerpt.", boundaryBefore: "start", boundaryAfter: "sentence" };
const settings = { voice: "Kore", speed: 1.2, narratorDirection: "  Warm   and restrained.  " };
const audio = () => new Response(new Uint8Array([0, 0, 1, 0]), { headers: { "Content-Type": "audio/pcm", "x-generation-id": "gen-test" } });
const rejected = () => new Response(JSON.stringify({ error: { message: "Provider returned 400" } }), { status: 400 });
class Client {
  readyState = 1;
  sent = [];
  send(value) { this.sent.push(Buffer.isBuffer(value) ? value : JSON.parse(value)); }
  events(type) { return this.sent.filter((event) => event.type === type); }
}
afterEach(() => vi.unstubAllGlobals());

describe.each(models)("Gemini model %s", (model) => {
  const legacy = model === models[0];
  const options = { provider: "openrouter", model, voice: settings.voice, speed: settings.speed, geminiPreviousContext: true, geminiFollowingContext: true, geminiNarratorDirection: settings.narratorDirection };

  it("shares capabilities and enforces settings on the server", () => {
    expect(getOpenRouterGeminiCapabilities(` ${model.toUpperCase()} `)).toMatchObject({
      promptFormat: legacy ? "legacy" : "instructions", neighboringContext: legacy,
      narratorDirection: true, semanticSegmentation: true, defaultSegmentChars: 500, maxSegmentChars: 2500
    });
    expect(sanitizeOptions(options)).toMatchObject({ segmentChars: 500, geminiPreviousContext: legacy, geminiFollowingContext: legacy, geminiNarratorDirection: "Warm and restrained." });
    expect(sanitizeOptions({ ...options, segmentChars: 12000 }).segmentChars).toBe(2500);
    expect(sanitizeOptions({ ...options, geminiNarratorDirection: "x".repeat(900) }).geminiNarratorDirection).toHaveLength(800);
  });

  it("constructs the correct transcript and delivery fields", () => {
    const body = buildGeminiSpeechBody(segment, { ...settings, model });
    expect(body).toMatchObject({ model, voice: "Kore", response_format: "pcm" });
    expect(body).not.toHaveProperty("speed");
    if (legacy) {
      expect(body).not.toHaveProperty("instructions");
      expect(body.input).toContain("# TRANSCRIPT\nChapter One\n\nThe passage. <sigh>");
      expect(body.input).toContain(segment.previousContext);
    } else {
      expect(body.input).toBe("Chapter One\n\nThe passage. <sigh>");
      expect(body.instructions).toContain("Warm and restrained.");
      expect(body.instructions).toContain("180 words per minute");
      expect(JSON.stringify(body)).not.toContain("Secret");
      expect(buildGeminiSpeechBody({ ...segment, text: "Next passage.", boundaryBefore: "sentence" }, { ...settings, model }).instructions).toBe(body.instructions);
    }
  });

  it("uses semantic segments and keeps the correct request format after automatic retry", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(rejected()).mockImplementation(async () => audio());
    vi.stubGlobal("fetch", fetchMock);
    const text = `Chapter One\n\n${"A complete sentence carries the narration forward. ".repeat(22)}\n\nChapter Two\n\nThe final scene begins.`;
    const expected = createGeminiNarrationSegments(text, { targetChars: 500 });
    const client = new Client();
    const session = createNarrationSession(client);
    session.handleClientMessage({ type: "start", apiKey: "mock", text, options });
    await vi.waitFor(() => expect(client.events("complete")).toHaveLength(1));
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies).toHaveLength(expected.length + 1);
    expect(client.events("meta")[0]).toMatchObject({ totalSegments: expected.length, audioEncoding: "pcm_s16le", sampleRate: 24000 });
    expect(client.events("segmentDone")[0].generationId).toBe("gen-test");
    for (const body of bodies) {
      expect(body.model).toBe(model);
      expect(body).not.toHaveProperty("speed");
      expect(legacy ? body.input : body.instructions).toContain("Warm and restrained.");
    }
    if (legacy) expect(bodies[1].input).toContain("Previous: none\nFollowing: none");
    else {
      expect(bodies[0]).toEqual(bodies[1]);
      expect(bodies.slice(1).map((body) => body.input)).toEqual(expected.map(({ text }) => prepareGeminiTranscript(text)));
    }
  });

  it.each(["retrySegment", "smartRetrySegment", "autoSmartRetry"])("preserves delivery settings during %s", async (command) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(rejected()).mockResolvedValueOnce(rejected()).mockImplementation(async () => audio());
    vi.stubGlobal("fetch", fetchMock);
    const client = new Client();
    const session = createNarrationSession(client);
    session.handleClientMessage({ type: "start", apiKey: "mock", text: "**Alpha beta gamma delta.**", options: { ...options, autoSmartRetry: command === "autoSmartRetry" } });
    if (command !== "autoSmartRetry") {
      await vi.waitFor(() => expect(client.events("segmentFailed")).toHaveLength(1));
      session.handleClientMessage({ type: command });
    }
    await vi.waitFor(() => expect(client.events("complete")).toHaveLength(1));
    if (command === "autoSmartRetry") expect(client.events("segmentFailed")).toHaveLength(0);
    const bodies = fetchMock.mock.calls.slice(2).map(([, init]) => JSON.parse(init.body));
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).toMatchObject({ model, voice: "Kore", response_format: "pcm" });
      expect(body).not.toHaveProperty("speed");
      expect(legacy ? body.input : body.instructions).toContain("Warm and restrained.");
      expect(legacy ? body.input : body.instructions).toContain("180 words per minute");
      if (!legacy) expect(body.input).not.toMatch(/\*|Read the following|TRANSCRIPT|Warm and restrained/);
    }
    if (!legacy) expect(bodies.map((body) => body.input).join(" ")).toBe("Alpha beta gamma delta.");
  });

  it("retries transient failures and respects cancellation", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("temporary", { status: 503 })).mockImplementation(async () => audio());
    const body = buildGeminiSpeechBody(segment, { ...settings, model });
    const result = await requestOpenRouterGeminiSpeech({ ...body, url: "mock", apiKey: "mock", fetchImpl, sleep: vi.fn() });
    expect(result).toMatchObject({ attempts: 2, generationId: "gen-test" });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual(body);
    expect(fetchImpl.mock.calls[1][1].body).toBe(fetchImpl.mock.calls[0][1].body);
    const controller = new AbortController();
    controller.abort();
    await expect(requestOpenRouterGeminiSpeech({ ...body, url: "mock", apiKey: "mock", fetchImpl, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

it("does not infer narration capabilities or prompt syntax from an unknown model's audio format", async () => {
  const model = "google/gemini-future-tts";
  expect(getOpenRouterGeminiCapabilities(model)).toBeUndefined();
  expect(() => buildGeminiSpeechBody(segment, { ...settings, model })).toThrow("Unsupported");
  const fetchMock = vi.fn(async () => audio());
  vi.stubGlobal("fetch", fetchMock);
  const client = new Client();
  createNarrationSession(client).handleClientMessage({ type: "start", apiKey: "mock", text: "Only this passage.", options: { provider: "openrouter", model, voice: "Kore" } });
  await vi.waitFor(() => expect(client.events("complete")).toHaveLength(1));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).input).toBe("Only this passage.");
});

function wav() {
  // Include an odd-sized unknown chunk to exercise RIFF chunk padding.
  const bytes = Buffer.alloc(58);
  bytes.write("RIFF"); bytes.writeUInt32LE(50, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("JUNK", 36); bytes.writeUInt32LE(1, 40);
  bytes.write("data", 46); bytes.writeUInt32LE(4, 50); bytes.set([1, 0, 2, 0], 54);
  return bytes;
}

describe.each(models)("audio validation for %s", (model) => {
  const request = (bytes, contentType = "audio/pcm") => requestOpenRouterGeminiSpeech({ model, url: "mock", apiKey: "mock", input: "Passage.", voice: "Kore", maxAttempts: 1, fetchImpl: async () => new Response(bytes, { headers: { "Content-Type": contentType } }) });
  it("extracts WAV PCM including padded metadata", async () => {
    expect(Array.from((await request(wav(), "audio/wav")).audio)).toEqual([1, 0, 2, 0]);
  });
  it("rejects empty, odd-length, non-audio, truncated, and incompatible audio", async () => {
    await expect(request(new Uint8Array())).rejects.toThrow("empty");
    await expect(request(new Uint8Array([1]))).rejects.toThrow("odd-length");
    await expect(request("{}", "application/json")).rejects.toThrow("application/json");
    await expect(request(wav().subarray(0, 56))).rejects.toThrow("truncated");
    const wrongRate = wav(); wrongRate.writeUInt32LE(48000, 24);
    await expect(request(wrongRate)).rejects.toThrow("24 kHz");
    const noData = wav(); noData.write("JUNK", 46);
    await expect(request(noData)).rejects.toThrow("invalid WAV");
  });
});
