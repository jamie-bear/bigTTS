import { afterEach, describe, expect, it, vi } from "vitest";
import { createNarrationSession } from "../../src/server.js";
import { splitRetryText } from "../../src/server/smartRetry.js";

const options = {
  provider: "openrouter", model: "google/gemini-3.1-flash-tts-preview", voice: "Kore", speed: 1,
  segmentChars: 2500, geminiPreviousContext: true, geminiFollowingContext: true, geminiNarratorDirection: "Warm narration."
};
const rejected = (status = 400, message = "Provider returned 400") => new Response(JSON.stringify({ error: { message, code: status } }), { status });
const audio = (number = 1) => new Response(new Uint8Array([number, 0]), { headers: { "Content-Type": "audio/pcm" } });
const transcript = (init) => JSON.parse(init.body).input.split("# TRANSCRIPT\n")[1];

class Client {
  readyState = 1;
  sent = [];
  send(value) { this.sent.push(Buffer.isBuffer(value) ? value : JSON.parse(value)); }
  events(type) { return this.sent.filter((event) => event.type === type); }
  get audio() { return this.sent.filter(Buffer.isBuffer); }
}

async function failedSession(text = "alpha beta gamma delta", override = {}) {
  const client = new Client();
  const session = createNarrationSession(client);
  session.handleClientMessage({ type: "start", apiKey: "test-key", text, options: { ...options, ...override } });
  await vi.waitFor(() => expect(client.events("segmentFailed")).toHaveLength(1));
  return { client, session };
}

afterEach(() => vi.unstubAllGlobals());

describe("server Smart retry", () => {
  it("buffers pieces sequentially, removes context, preserves settings and numbering, and reports omissions", async () => {
    const requests = [];
    let active = 0;
    const fetchMock = vi.fn(async (_url, init) => {
      active += 1;
      expect(active).toBe(1);
      const text = transcript(init);
      requests.push(JSON.parse(init.body));
      await Promise.resolve();
      active -= 1;
      if (requests.length <= 2 || text.includes("gamma")) return rejected();
      return audio(text.includes("alpha") ? 1 : 2);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { client, session } = await failedSession();
    expect(client.events("segmentFailed")[0]).toMatchObject({ smartRetryAvailable: true, smartRetryResumable: false });
    session.handleClientMessage({ type: "smartRetrySegment" });
    session.handleClientMessage({ type: "smartRetrySegment" });
    session.handleClientMessage({ type: "retrySegment" });
    await vi.waitFor(() => expect(client.events("complete")).toHaveLength(1));
    expect(requests).toHaveLength(6);
    for (const body of requests.slice(2)) {
      expect(body).toMatchObject({ model: options.model, voice: "Kore", response_format: "pcm" });
      expect(body.input).toContain("Previous: none\nFollowing: none");
      expect(body.input).toContain("Additional narrator direction: Warm narration.");
    }
    expect(client.audio).toEqual([Buffer.from([1, 0, 2, 0])]);
    expect(client.events("segmentDone")).toEqual([expect.objectContaining({ index: 1, totalSegments: 1, omissions: [{ index: 1, text: "gamma " }] })]);
    expect(client.events("smartRetryProgress").at(-1)).toMatchObject({ attempts: 4, resolvedPieces: 2, skippedPieces: 1 });
  });

  it("reports an entirely omitted segment without an empty audio payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => rejected()));
    const { client, session } = await failedSession("one two");
    session.handleClientMessage({ type: "smartRetrySegment" });
    await vi.waitFor(() => expect(client.events("complete")).toHaveLength(1));
    expect(client.audio).toEqual([]);
    expect(client.events("segmentDone")).toEqual([]);
    expect(client.events("segmentSkipped")[0]).toMatchObject({ index: 1, omissions: [{ index: 1, text: "one " }, { index: 1, text: "two" }] });
  });

  it("resumes a 64-attempt checkpoint with its successful audio intact", async () => {
    const text = Array.from({ length: 100 }, (_, index) => `word${index}`).join(" ");
    const successes = [];
    const fetchMock = vi.fn(async (_url, init) => {
      const value = transcript(init);
      if (splitRetryText(value)) return rejected();
      successes.push(value);
      return audio(Number(value.slice(4)));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { client, session } = await failedSession(text);
    session.handleClientMessage({ type: "smartRetrySegment" });
    await vi.waitFor(() => expect(client.events("segmentFailed")).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(66);
    expect(client.audio).toHaveLength(0);
    expect(client.events("segmentFailed")[1]).toMatchObject({ smartRetryAvailable: true, smartRetryResumable: true, message: expect.stringContaining("64 piece attempts") });
    for (let batch = 0; batch < 4 && !client.events("complete").length; batch += 1) {
      const failureCount = client.events("segmentFailed").length;
      session.handleClientMessage({ type: "smartRetrySegment" });
      await vi.waitFor(() => expect(client.events("complete").length || client.events("segmentFailed").length > failureCount).toBeTruthy());
    }
    expect(client.events("complete")).toHaveLength(1);
    expect(successes).toEqual(Array.from({ length: 100 }, (_, index) => `word${index}`));
    expect(client.audio).toEqual([Buffer.from(Array.from({ length: 100 }, (_, index) => [index, 0]).flat())]);
  });

  it.each(["retrySegment", "skipSegment"])("%s discards saved recovery audio", async (command) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(rejected()).mockResolvedValueOnce(rejected())
      .mockResolvedValueOnce(audio(7)).mockResolvedValueOnce(rejected(401, "Invalid API key"));
    vi.stubGlobal("fetch", fetchMock);
    const { client, session } = await failedSession();
    session.handleClientMessage({ type: "smartRetrySegment" });
    await vi.waitFor(() => expect(client.events("segmentFailed")).toHaveLength(2));
    expect(client.events("segmentFailed")[1].smartRetryResumable).toBe(true);
    expect(client.audio).toEqual([]);
    fetchMock.mockResolvedValueOnce(audio(9));
    session.handleClientMessage({ type: command });
    await vi.waitFor(() => expect(client.events("complete")).toHaveLength(1));
    expect(client.audio).toEqual(command === "retrySegment" ? [Buffer.from([9, 0])] : []);
    if (command === "retrySegment") expect(transcript(fetchMock.mock.calls.at(-1)[1])).toBe("alpha beta gamma delta");
  });

  it("retries a saved piece after an infrastructure failure without omission", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(rejected()).mockResolvedValueOnce(rejected())
      .mockResolvedValueOnce(audio(1)).mockResolvedValueOnce(rejected(401, "Invalid API key"))
      .mockResolvedValueOnce(audio(2));
    vi.stubGlobal("fetch", fetchMock);
    const { client, session } = await failedSession();
    session.handleClientMessage({ type: "smartRetrySegment" });
    await vi.waitFor(() => expect(client.events("segmentFailed")).toHaveLength(2));
    session.handleClientMessage({ type: "smartRetrySegment" });
    await vi.waitFor(() => expect(client.events("complete")).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(transcript(fetchMock.mock.calls[3][1])).toBe(transcript(fetchMock.mock.calls[4][1]));
    expect(client.audio).toEqual([Buffer.from([1, 0, 2, 0])]);
    expect(client.events("segmentDone")[0].omissions).toEqual([]);
  });

  it("aborts Stop and ignores a late result after restarting", async () => {
    let resolveOld;
    let oldSignal;
    const fetchMock = vi.fn().mockResolvedValueOnce(rejected()).mockResolvedValueOnce(rejected())
      .mockImplementationOnce((_url, init) => {
        oldSignal = init.signal;
        return new Promise((resolve) => { resolveOld = resolve; });
      }).mockResolvedValueOnce(audio(9));
    vi.stubGlobal("fetch", fetchMock);
    const { client, session } = await failedSession();
    session.handleClientMessage({ type: "smartRetrySegment" });
    await vi.waitFor(() => expect(resolveOld).toBeDefined());
    session.handleClientMessage({ type: "cancel" });
    expect(oldSignal.aborted).toBe(true);
    session.handleClientMessage({ type: "start", apiKey: "key", text: "A new narration.", options });
    await vi.waitFor(() => expect(client.events("complete")).toHaveLength(1));
    resolveOld(audio(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.audio).toEqual([Buffer.from([9, 0])]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("finishes all recovered pieces before pausing, then resumes the next segment", async () => {
    let resolveFirst;
    const fetchMock = vi.fn().mockResolvedValueOnce(rejected()).mockResolvedValueOnce(rejected())
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementation(async () => audio(2));
    vi.stubGlobal("fetch", fetchMock);
    const { client, session } = await failedSession("A complete sentence with enough text to read aloud. ".repeat(20), { segmentChars: 300 });
    session.handleClientMessage({ type: "smartRetrySegment" });
    await vi.waitFor(() => expect(resolveFirst).toBeDefined());
    session.handleClientMessage({ type: "pause" });
    expect(client.events("pausePending")).toHaveLength(1);
    resolveFirst(audio(1));
    await vi.waitFor(() => expect(client.events("paused")).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(client.events("segmentDone")).toHaveLength(1);
    expect(client.audio[0]).toEqual(Buffer.from([1, 0, 2, 0]));
    session.handleClientMessage({ type: "resume" });
    await vi.waitFor(() => expect(client.events("complete")).toHaveLength(1));
    expect(client.events("segmentDone")[1].index).toBe(2);
  });

  it.each([
    [options.model, 401], [options.model, 400, "Invalid voice parameter"], ["openai/tts-1", 400]
  ])("does not offer or execute Smart retry for ineligible failures (%s, %s)", async (model, status, message) => {
    const fetchMock = vi.fn(async () => rejected(status, message));
    vi.stubGlobal("fetch", fetchMock);
    const { client, session } = await failedSession("A rejected segment.", { model });
    expect(client.events("segmentFailed")[0].smartRetryAvailable).toBe(false);
    session.handleClientMessage({ type: "smartRetrySegment" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
