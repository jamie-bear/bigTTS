import { afterEach, describe, expect, it, vi } from "vitest";
import { listResembleCustomVoices, normalizeResembleVoices, sanitizeOptions, synthesizeMiniMaxSpeech, synthesizeResembleSpeech, uploadMiniMaxAudio, requestMiniMaxJson, buildMiniMaxVoiceClonePayload, createNarrationSession } from "../../src/server.js";
import { buildResembleData, splitResembleText, parseMiniMaxJson, stringifyMiniMaxPayload, decodeResembleWav, decodeMiniMaxAudio, validateCloneAudio } from "../../src/server/providerContracts.js";
import { normalizeResembleSettings, normalizeMinimaxSettings, minimaxPrice, validateCloneDuration } from "../../src/shared/speechSettings.js";

function wav(samples = [1, -1, 200, -200], rate = 22050) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write("RIFF"); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, 44 + index * 2));
  return buffer;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("provider request limits and settings", () => {
  it("enforces limits for direct socket callers and gates unsupported language/emotion combinations", () => {
    expect(sanitizeOptions({ provider: "resemble", voice: "voice", segmentChars: 12000 }).segmentChars).toBe(3000);
    expect(sanitizeOptions({ provider: "minimax", voice: "voice", segmentChars: 12000, speed: 2 }).segmentChars).toBe(9999);
    expect(sanitizeOptions({ provider: "minimax", voice: "voice", speed: 0.5 }).speed).toBe(0.5);
    expect(() => sanitizeOptions({ provider: "minimax", voice: "voice", model: "speech-02-hd", language: "Tamil" })).toThrow("not supported");
    expect(() => normalizeMinimaxSettings({ emotion: "whisper" }, "speech-2.8-hd")).toThrow("not supported");
    expect(normalizeMinimaxSettings({ emotion: "whisper" }, "speech-2.6-hd").emotion).toBe("whisper");
    expect(() => normalizeMinimaxSettings({ pronunciation: "missing separator" })).toThrow("original/replacement");
  });

  it("budgets escaped SSML and narrator attributes, preserving Unicode and text", () => {
    const settings = normalizeResembleSettings({ prompt: 'Calm & warm "voice"', language: "de-DE", delivery: "slow", temperature: "0.8", exaggeration: "0", seed: "0" });
    const text = '&<>"\'😀'.repeat(1500);
    const segments = splitResembleText(text, 3000, settings);
    expect(segments.join("")).toBe(text);
    for (const segment of segments) {
      const data = buildResembleData(segment, settings);
      expect(data.length).toBeLessThanOrEqual(3000);
      expect(data).toContain('prompt="Calm &amp; warm &quot;voice&quot;"');
      expect(data).toContain('exaggeration="0" seed="0"');
      expect(data).toMatch(/<slow>.*<\/slow><\/speak>$/u);
      expect(segment).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    }
    expect(() => splitResembleText("hello", 2500, normalizeResembleSettings({ prompt: '"'.repeat(800) }))).toThrow("too little room");
  });

  it("prices documented models only", () => {
    expect(minimaxPrice("speech-2.8-hd")).toBe(100);
    expect(minimaxPrice("speech-2.6-turbo")).toBe(60);
    expect(minimaxPrice("speech-02-hd")).toBe(100);
    expect(minimaxPrice("speech-01-hd")).toBeUndefined();
  });
});

describe("voice discovery", () => {
  it.each(["num_pages", "page_count", "total_pages"])("follows %s, deduplicates and requests advanced metadata", async (field) => {
    const fetchMock = vi.fn(async (url) => {
      expect(url.searchParams.get("advanced")).toBe("true");
      return json({ success: true, [field]: 2, items: [{ uuid: "same", name: "Voice" }, ...(url.searchParams.get("page") === "2" ? [{ uuid: "second" }] : [])] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await listResembleCustomVoices("key");
    expect(result.voices.map((voice) => voice.id)).toEqual(["same", "second"]);
    expect(result.warning).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("reports incomplete discovery at its safety limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ success: true, num_pages: 21, items: [{ uuid: "voice" }] })));
    expect((await listResembleCustomVoices("key")).warning).toContain("incomplete");
    expect(fetch).toHaveBeenCalledTimes(20);
  });
  it("keeps unknown models usable and marks confirmed retired voices unavailable", () => {
    const voices = normalizeResembleVoices({ items: [
      { uuid: "ultra", model_version: "resemble-ultra", status: "ready" },
      { uuid: "old", model_version: "tts-v4-turbo", status: "ready" },
      { uuid: "unknown" }, { uuid: "building", status: "building" },
      { uuid: "system", pre_built_resemble_voice: true }, { uuid: "market", source: "marketplace" }
    ] });
    expect(voices.map((voice) => [voice.id, voice.available])).toEqual([["ultra", true], ["old", false], ["unknown", true], ["building", false]]);
    expect(voices[1].unavailableReason).toContain("Ultra");
  });
});

describe("cloning contracts", () => {
  it("preserves numeric int64 IDs from upload JSON through the clone request", () => {
    const parsed = parseMiniMaxJson('{"file":{"file_id":9223372036854775807},"message":"12345678901234567890"}');
    const payload = buildMiniMaxVoiceClonePayload({ sourceFileId: parsed.file.file_id, voiceId: "narrator", promptFileId: "9223372036854775806", promptText: 'Keep "file_id":"123" literal', validationText: "hello", noiseReduction: false, volumeNormalization: false, accuracy: 0.9 });
    const serialized = stringifyMiniMaxPayload(payload);
    expect(serialized).toContain('"file_id":9223372036854775807');
    expect(serialized).toContain('"prompt_audio":9223372036854775806');
    expect(payload).toMatchObject({ need_noise_reduction: false, need_volume_normalization: false, accuracy: 0.9 });
    expect(payload).not.toHaveProperty("text");
    expect(parseMiniMaxJson(serialized).clone_prompt.prompt_text).toBe('Keep "file_id":"123" literal');
    expect(() => buildMiniMaxVoiceClonePayload({ sourceFileId: Number("9223372036854775807"), voiceId: "voice" })).toThrow("precision");
  });
  it("rejects invalid file contents, extensions, empty and oversized recordings", () => {
    expect(validateCloneAudio(wav().toString("base64"), "sample.wav").contentType).toBe("audio/wav");
    expect(() => validateCloneAudio(wav().toString("base64"), "sample.mp3")).toThrow("contents");
    expect(() => validateCloneAudio("not base64", "sample.wav")).toThrow("base64");
    expect(() => validateCloneAudio("", "sample.wav")).toThrow();
    expect(() => validateCloneAudio(Buffer.alloc(20 * 1024 * 1024 + 1).toString("base64"), "sample.wav")).toThrow("20 MB");
  });
  it("enforces source and prompt duration boundaries", () => {
    for (const seconds of [10, 300]) expect(() => validateCloneDuration(seconds)).not.toThrow();
    for (const seconds of [0, 9.99, 300.01, Infinity, NaN]) expect(() => validateCloneDuration(seconds)).toThrow();
    expect(() => validateCloneDuration(7.99, true)).not.toThrow();
    expect(() => validateCloneDuration(8, true)).toThrow();
  });
  it("checks upload provider status and retains diagnostics even on HTTP 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ base_resp: { status_code: 1004, status_msg: "Authentication failed" }, trace_id: "upload-trace" })));
    await expect(uploadMiniMaxAudio("key", { purpose: "voice_clone", audio: wav().toString("base64"), filename: "sample.wav" })).rejects.toMatchObject({ details: { providerCode: "1004", requestId: "upload-trace" } });
  });
});

describe("audio and provider responses", () => {
  it.each([1, 2, 3])("accepts wrapped and unpadded Resemble base64 for %i samples", (count) => {
    const bytes = wav(Array.from({ length: count }, (_, index) => index + 1));
    const encoded = bytes.toString("base64");
    const wrapped = ` \t${encoded.match(/.{1,20}/g).join("\r\n")}\n`;
    for (const value of [encoded, wrapped, encoded.replace(/=+$/, ""), wrapped.replace(/=/g, ""), bytes.toString("base64url")]) {
      expect(decodeResembleWav(value)).toEqual(bytes.subarray(44));
    }
  });

  it("rejects corrupt base64 and still validates decoded WAV format", () => {
    const encoded = wav().toString("base64");
    for (const value of ["A", "A===", "AQ=", "AQ==junk", "AA=A", "!!!!", encoded + "=", encoded.slice(0, 8) + "!" + encoded.slice(8), "data:audio/wav;base64," + encoded]) {
      expect(() => decodeResembleWav(value)).toThrow("invalid base64");
    }
    const wrongRate = wav([1, 2, 3], 24000).toString("base64").replace(/=+$/, "") + "\n";
    expect(() => decodeResembleWav(wrongRate)).toThrow("invalid WAV");
    expect(() => decodeResembleWav(Buffer.from("not a WAV").toString("base64") + "\n")).toThrow("invalid WAV");
  });

  it("distinguishes missing Resemble audio from malformed base64", () => {
    for (const value of [undefined, null, "", " \r\n"]) expect(() => decodeResembleWav(value)).toThrow("missing audio_content");
    for (const value of [12, {}, []]) expect(() => decodeResembleWav(value)).toThrow("must be a base64 string");
  });

  it("decodes line-wrapped synthesis responses through the Resemble request path", async () => {
    const encoded = wav().toString("base64");
    vi.stubGlobal("fetch", vi.fn(async () => json({ success: true, audio_content: encoded.match(/.{1,20}/g).join("\n") + "\n" })));
    await expect(synthesizeResembleSpeech("Hello", { voice: "voice", resemble: {} }, "key")).resolves.toEqual(wav().subarray(44));
  });

  it("handles a segment-sized wrapped Resemble WAV without regex stack limits", () => {
    const bytes = Buffer.alloc(44 + 2 * 1024 * 1024);
    wav([]).copy(bytes);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.writeUInt32LE(bytes.length - 44, 40);
    const encoded = bytes.toString("base64").match(/.{1,76}/g).join("\n") + "\n";
    expect(decodeResembleWav(encoded).equals(bytes.subarray(44))).toBe(true);
  });

  it("reports missing audio and provider issues without losing the request ID", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ success: true, issues: ["No audio generated"], trace_id: "resemble-trace" })));
    await expect(synthesizeResembleSpeech("Hello", { voice: "voice", resemble: {} }, "key")).rejects.toMatchObject({
      message: expect.stringContaining("missing audio_content. Provider issues: No audio generated"),
      details: { providerName: "Resemble.ai", status: 200, requestId: "resemble-trace" }
    });
  });

  it("identifies malformed JSON responses and retains the response request ID", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Gateway problem</html>", { headers: { "x-request-id": "gateway-trace" } })));
    await expect(synthesizeResembleSpeech("Hello", { voice: "voice", resemble: {} }, "key")).rejects.toMatchObject({
      message: expect.stringContaining("not a JSON object containing audio_content"),
      details: { requestId: "gateway-trace" }
    });
  });

  it("requires exact hex and mono PCM16 WAV rather than guessing audio formats", () => {
    expect(decodeMiniMaxAudio("ff001a")).toEqual(Buffer.from([255, 0, 26]));
    for (const audio of ["AQIDBA==", "abc", "", null]) expect(() => decodeMiniMaxAudio(audio)).toThrow();
    expect(decodeResembleWav(wav().toString("base64"))).toEqual(wav().subarray(44));
    expect(() => decodeResembleWav(wav([], 24000).toString("base64"))).toThrow();
    const wrongBits = wav(); wrongBits.writeUInt16LE(32, 34);
    expect(() => decodeResembleWav(wrongBits.toString("base64"))).toThrow();
    expect(() => decodeResembleWav(wav().subarray(0, 45).toString("base64"))).toThrow();
  });
  it("parses and validates segment-sized audio without regex stack limits", () => {
    const hex = "ff".repeat(2 * 1024 * 1024);
    const parsed = parseMiniMaxJson(JSON.stringify({ data: { audio: hex }, base_resp: { status_code: 0 } }));
    expect(decodeMiniMaxAudio(parsed.data.audio)).toHaveLength(2 * 1024 * 1024);
    expect(parseMiniMaxJson('{"file_id":9223372036854775807,"broken":}')).toBeNull();
  });
  it("sends MiniMax controls and keeps a response trace on malformed audio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ base_resp: { status_code: 0 }, trace_id: "trace", data: { status: 2, audio: "oops" } })));
    const options = sanitizeOptions({ provider: "minimax", voice: "voice", minimax: { volume: 2, pitch: -3, emotion: "calm", textNormalization: true, pronunciation: "Dr./Doctor" } });
    await expect(synthesizeMiniMaxSpeech("Hello", options, "key")).rejects.toMatchObject({ details: { requestId: "trace" } });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.voice_setting).toMatchObject({ vol: 2, pitch: -3, emotion: "calm", text_normalization: true });
    expect(body.pronunciation_dict.tone).toEqual(["Dr./Doctor"]);
  });
  it("sends Resemble HD/pronunciation/SSML without a model field", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ success: true, audio_content: wav().toString("base64") })));
    const options = sanitizeOptions({ provider: "resemble", voice: "voice", resemble: { hd: true, customPronunciations: true, prompt: "Warm", delivery: "fast" } });
    await synthesizeResembleSpeech("A & B", options, "key");
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ use_hd: true, apply_custom_pronunciations: true, data: '<speak prompt="Warm"><fast>A &amp; B</fast></speak>' });
    expect(body).not.toHaveProperty("model");
  });
  it("rejects provider-level failures with HTTP 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ success: false, error: "Upgrade the voice" })));
    await expect(synthesizeResembleSpeech("Hi", { resemble: {} }, "key")).rejects.toThrow("Upgrade");
    vi.stubGlobal("fetch", vi.fn(async () => json({ base_resp: { status_code: 1002, status_msg: "Rate limit" }, trace_id: "trace" })));
    await expect(requestMiniMaxJson("https://api.minimax.io", { apiKey: "key" })).rejects.toMatchObject({ details: { providerCode: "1002", requestId: "trace" } });
  });
  it("enforces timeout even with a session signal, and supports cancellation", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))));
    const session = new AbortController();
    const timed = expect(requestMiniMaxJson("https://api.minimax.io", { apiKey: "key", signal: session.signal, timeoutMs: 100 })).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(100); await timed;
    expect(session.signal.aborted).toBe(false);
    const cancelled = expect(requestMiniMaxJson("https://api.minimax.io", { apiKey: "key", signal: session.signal })).rejects.toThrow("Stopped");
    session.abort(new Error("Stopped")); await cancelled;
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["resemble", "minimax"])("generates multiple %s segments within limits and forwards audio in order", async (provider) => {
    const sent = [];
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      expect((body.data || body.text).length).toBeLessThanOrEqual(provider === "resemble" ? 3000 : 9999);
      return provider === "resemble" ? json({ success: true, audio_content: wav().toString("base64") }) : json({ base_resp: { status_code: 0 }, data: { status: 2, audio: "fffb9064" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const session = createNarrationSession({ readyState: 1, send: (value) => sent.push(Buffer.isBuffer(value) ? value : JSON.parse(value)) });
    session.handleClientMessage({ type: "start", apiKey: "key", text: "A story with & symbols. ".repeat(1100), options: { provider, voice: "voice", segmentChars: 12000 } });
    await vi.waitFor(() => expect(sent.some((event) => event.type === "complete")).toBe(true));
    const requests = fetchMock.mock.calls.length;
    expect(requests).toBeGreaterThan(1);
    expect(sent.filter(Buffer.isBuffer)).toHaveLength(requests);
    expect(sent.filter((event) => event.type === "segmentDone").map((event) => event.index)).toEqual(Array.from({ length: requests }, (_, index) => index + 1));
  });
});
