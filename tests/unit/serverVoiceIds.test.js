import { afterEach, describe, expect, it, vi } from "vitest";
import { createNarrationSession } from "../../src/server.js";

describe("provider voice IDs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["resemble", "minimax"])("forwards an unlisted %s voice ID to synthesis with its casing intact", async (provider) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(provider === "resemble"
      ? { success: true, audio_content: validWav().toString("base64") }
      : { data: { audio: "01020304", status: 2 }, base_resp: { status_code: 0 } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const events = [];
    const session = createNarrationSession({ readyState: 1, send: (value) => { if (!Buffer.isBuffer(value)) events.push(JSON.parse(value)); } });
    try {
      session.handleClientMessage({ type: "start", apiKey: "test-key", text: "Read this sentence.", options: { provider, voice: "  External-AbC_819fcc57  ", model: "speech-2.8-hd" } });
      await vi.waitFor(() => expect(events.some(({ type }) => type === "complete")).toBe(true));
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, request] = fetchMock.mock.calls[0];
      const body = JSON.parse(request.body);
      if (provider === "resemble") {
        expect(url).toBe("https://f.cluster.resemble.ai/synthesize");
        expect(body.voice_uuid).toBe("External-AbC_819fcc57");
      } else {
        expect(url).toBe("https://api.minimax.io/v1/t2a_v2");
        expect(body.voice_setting.voice_id).toBe("External-AbC_819fcc57");
      }
    } finally { session.cancel("Test finished."); }
  });

  it.each(["resemble", "minimax"])("rejects an empty %s voice with guidance for either input method", async (provider) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const events = [];
    const session = createNarrationSession({ readyState: 1, send: (value) => { if (!Buffer.isBuffer(value)) events.push(JSON.parse(value)); } });
    session.handleClientMessage({ type: "start", apiKey: "test-key", text: "Read this.", options: { provider, voice: "   " } });
    await vi.waitFor(() => expect(events.find(({ type }) => type === "error")?.message).toContain("Select a custom voice or enter a voice ID"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function validWav() {
  const audio = Buffer.alloc(48);
  audio.write("RIFF"); audio.writeUInt32LE(40, 4); audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(22050, 24); audio.writeUInt32LE(44100, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write("data", 36); audio.writeUInt32LE(4, 40);
  return audio;
}
