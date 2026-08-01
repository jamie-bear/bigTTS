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

const response = () => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ inlineData: { data: "AQIDBA==" } }] } }]
}), { status: 200, headers: { "Content-Type": "application/json" } });

describe("server narration pause state", () => {
  afterEach(() => vi.unstubAllGlobals());

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
});
