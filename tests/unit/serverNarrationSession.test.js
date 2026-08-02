import { afterEach, describe, expect, it, vi } from "vitest";
import { createNarrationSession } from "../../src/server.js";

class FakeClient {
  readyState = 1;
  sent = [];

  send(value) {
    this.sent.push(Buffer.isBuffer(value) ? value : JSON.parse(String(value)));
  }

  events(type) {
    return this.sent.filter((value) => !Buffer.isBuffer(value) && value.type === type);
  }
}

const options = {
  provider: "gemini",
  voice: "Kore",
  language: "auto",
  speed: 1,
  segmentChars: 300,
  optimizeStreamingLatency: false,
  textNormalization: false,
  model: "",
  geminiContinuity: false,
  geminiNarratorDirection: ""
};

const openRouterOptions = {
  ...options,
  provider: "openrouter",
  model: "google/gemini-3.1-flash-tts-preview",
  geminiContinuity: true
};

const response = () => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ inlineData: { data: "AQIDBA==" } }] } }]
}), { status: 200, headers: { "Content-Type": "application/json" } });

describe("server narration pause state", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects direct Google credentials when no local OAuth refresh token exists", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new FakeClient();
    const session = createNarrationSession(client);

    session.handleClientMessage({
      type: "start",
      apiKey: JSON.stringify({ type: "service_account", private_key: "obsolete" }),
      text: "Google OAuth is required.",
      options: { ...options, provider: "google", voice: "Enceladus" }
    });

    await vi.waitFor(() => expect(client.events("error")).toHaveLength(1));
    expect(client.events("error")[0].message).toBe("Connect Google before starting narration.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("can pause before the first provider request and resume from segment one", async () => {
    let resolveRequest;
    const fetchMock = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FakeClient();
    const session = createNarrationSession(client);
    session.handleClientMessage({ type: "start", apiKey: "test-key", text: "A complete sentence. ".repeat(40), options });
    session.handleClientMessage({ type: "pause" });

    await vi.waitFor(() => expect(client.events("paused")).toHaveLength(1));
    expect(client.events("paused")[0].completedSegments).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    session.handleClientMessage({ type: "resume" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(client.events("resumed")[0].nextSegment).toBe(1);
    resolveRequest(response());
    session.cancel("Test finished.");
  });

  it("finishes an in-flight segment, pauses before the next one, and resumes exactly once", async () => {
    const requestResolvers = [];
    const fetchMock = vi.fn(() => new Promise((resolve) => requestResolvers.push(resolve)));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FakeClient();
    const session = createNarrationSession(client);
    const text = "First sentence. ".repeat(30) + "\n\n" + "Second sentence. ".repeat(30);
    session.handleClientMessage({ type: "start", apiKey: "test-key", text, options });

    await vi.waitFor(() => expect(client.events("segment")).toHaveLength(1));
    session.handleClientMessage({ type: "pause" });
    expect(client.events("pausePending")).toHaveLength(1);
    requestResolvers[0](response());

    await vi.waitFor(() => expect(client.events("paused")).toHaveLength(1));
    expect(client.events("segmentDone")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledOnce();

    session.handleClientMessage({ type: "resume" });
    session.handleClientMessage({ type: "resume" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(client.events("resumed")).toHaveLength(1);
    expect(client.events("segment").at(-1).index).toBe(2);
    session.cancel("Test finished.");
  });

  it("automatically retries a rejected OpenRouter segment before showing recovery controls", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: 400,
          message: "Provider returned 400",
          metadata: { error_type: "content_policy_violation", provider_code: "PROHIBITED_CONTENT" }
        }
      }), { status: 400, headers: { "x-request-id": "req-failed" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 0, 1, 0]), { status: 200, headers: { "Content-Type": "audio/pcm", "x-generation-id": "gen-retried" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FakeClient();
    const session = createNarrationSession(client);

    session.handleClientMessage({ type: "start", apiKey: "test-key", text: "A segment that needs another attempt.", options: openRouterOptions });
    await vi.waitFor(() => expect(client.events("complete")).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.events("status").at(-1).message).toBe("Segment 1 failed; retrying automatically...");
    expect(client.events("segmentFailed")).toHaveLength(0);
    expect(client.events("segmentDone")[0]).toMatchObject({ index: 1, generationId: "gen-retried" });
  });

  it("drops Gemini continuity context on the automatic retry", async () => {
    const rejection = new Response(JSON.stringify({
      error: { code: 400, message: "Provider returned 400" }
    }), { status: 400 });
    const audioResponse = () => new Response(new Uint8Array([0, 0, 1, 0]), {
      status: 200,
      headers: { "Content-Type": "audio/pcm" }
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(rejection)
      .mockImplementation(async () => audioResponse());
    vi.stubGlobal("fetch", fetchMock);
    const client = new FakeClient();
    const session = createNarrationSession(client);
    const text = "A complete sentence carries the narration forward with enough detail. ".repeat(12);

    session.handleClientMessage({ type: "start", apiKey: "test-key", text, options: openRouterOptions });
    await vi.waitFor(() => expect(client.events("complete")).toHaveLength(1));

    const firstPrompt = JSON.parse(fetchMock.mock.calls[0][1].body).input;
    const retryPrompt = JSON.parse(fetchMock.mock.calls[1][1].body).input;
    expect(firstPrompt).toMatch(/Following: (?!none)/u);
    expect(retryPrompt).toContain("Previous: none\nFollowing: none");
  });

  it("keeps a rejected OpenRouter segment recoverable after its automatic retry fails", async () => {
    const rejection = (requestId) => new Response(JSON.stringify({
      error: {
        code: 400,
        message: "Provider returned 400",
        metadata: { error_type: "content_policy_violation", provider_code: "PROHIBITED_CONTENT" }
      }
    }), { status: 400, headers: { "x-request-id": requestId } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(rejection("req-failed-1"))
      .mockResolvedValueOnce(rejection("req-failed-2"))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 0, 1, 0]), { status: 200, headers: { "Content-Type": "audio/pcm", "x-generation-id": "gen-manual-retry" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FakeClient();
    const session = createNarrationSession(client);

    session.handleClientMessage({ type: "start", apiKey: "test-key", text: "A segment that needs manual recovery.", options: openRouterOptions });
    await vi.waitFor(() => expect(client.events("segmentFailed")).toHaveLength(1));
    expect(client.events("segmentFailed")[0]).toMatchObject({
      index: 1,
      message: "OpenRouter TTS request failed: Provider returned 400",
      details: {
        status: 400,
        errorType: "content_policy_violation",
        providerCode: "PROHIBITED_CONTENT",
        requestId: "req-failed-2",
        attempts: 1
      }
    });
    expect(client.events("error")).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    session.handleClientMessage({ type: "retrySegment" });
    await vi.waitFor(() => expect(client.events("complete")).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(client.events("segmentRetrying")[0].index).toBe(1);
    expect(client.events("segmentDone")[0]).toMatchObject({ index: 1, generationId: "gen-manual-retry" });
  });

  it("can skip a rejected OpenRouter segment without ending the session", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: 400, message: "Provider returned 400" } }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FakeClient();
    const session = createNarrationSession(client);

    session.handleClientMessage({ type: "start", apiKey: "test-key", text: "A rejected final segment.", options: openRouterOptions });
    await vi.waitFor(() => expect(client.events("segmentFailed")).toHaveLength(1));
    session.handleClientMessage({ type: "skipSegment" });
    await vi.waitFor(() => expect(client.events("complete")).toHaveLength(1));
    expect(client.events("segmentSkipped")[0]).toMatchObject({ index: 1, totalSegments: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
