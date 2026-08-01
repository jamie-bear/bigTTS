import { vi } from "vitest";
import { AudioEngine, createMpegBlob, createWavBlob, getLeadingId3v2Size, getTrailingId3v1Size } from "../../src/client/services/audioEngine";

describe("audio assembly", () => {
  it("creates a valid PCM WAV header", async () => {
    const blob = createWavBlob([new Uint8Array([1, 2, 3, 4]).buffer], { sampleRate: 24_000, channels: 1 });
    const bytes = new Uint8Array(await readBlob(blob));
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(blob.type).toBe("audio/wav");
  });

  it("removes repeated MP3 ID3 metadata between segments", async () => {
    const tagged = new Uint8Array(14);
    tagged.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]);
    expect(getLeadingId3v2Size(tagged.buffer)).toBe(10);
    expect(getTrailingId3v1Size(tagged.buffer)).toBe(0);
    const blob = createMpegBlob([[new Uint8Array([5, 6]).buffer], [tagged.buffer]]);
    expect(blob.type).toBe("audio/mpeg");
    expect(blob.size).toBe(6);
  });

  it("creates a stitched snapshot from an unfinished active segment", async () => {
    const audio = document.createElement("audio");
    audio.load = vi.fn();
    audio.play = vi.fn(async () => undefined);
    const onAudioAvailable = vi.fn();
    const engine = new AudioEngine(audio, { onStatus: vi.fn(), onBufferChange: vi.fn(), onLevel: vi.fn(), onAudioAvailable });
    engine.reset("pcm_s16le");
    engine.beginSegment(1);
    engine.push(new Uint8Array([1, 2, 3, 4]).buffer);
    const partial = engine.snapshot();
    expect(onAudioAvailable).toHaveBeenCalledOnce();
    expect(partial?.extension).toBe("wav");
    expect(partial?.blob.size).toBe(48);
    engine.dispose();
  });

  it("stages cumulative PCM updates until the current playback reaches its endpoint", () => {
    let nextUrl = 0;
    vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:pcm-${++nextUrl}`);
    const audio = document.createElement("audio");
    let paused = true;
    let ended = false;
    Object.defineProperty(audio, "paused", { configurable: true, get: () => paused });
    Object.defineProperty(audio, "ended", { configurable: true, get: () => ended });
    Object.defineProperty(audio, "duration", { configurable: true, get: () => 10 });
    audio.play = vi.fn(async () => { paused = false; });
    audio.load = vi.fn();
    const engine = new AudioEngine(audio, { onStatus: vi.fn(), onBufferChange: vi.fn(), onLevel: vi.fn(), onAudioAvailable: vi.fn() });
    engine.reset("pcm_s16le");

    engine.beginSegment(1);
    engine.push(new Uint8Array([1, 2, 3, 4]).buffer);
    const first = engine.finishSegment(1);
    expect(first?.blob.size).toBe(48);
    expect(audio.src).toContain("blob:pcm-1");
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.play).toHaveBeenCalledOnce();

    audio.currentTime = 1.5;
    engine.beginSegment(2);
    engine.push(new Uint8Array([5, 6, 7, 8]).buffer);
    const second = engine.finishSegment(2);
    expect(second?.blob.size).toBe(52);
    expect(audio.src).toContain("blob:pcm-1");
    expect(audio.load).toHaveBeenCalledTimes(2);
    paused = true;
    ended = true;
    audio.dispatchEvent(new Event("ended"));
    expect(audio.src).toContain("blob:pcm-2");
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(1.5);
    expect(audio.play).toHaveBeenCalledTimes(2);
    engine.dispose();
  });

  it("does not autoplay a cumulative update after the listener manually pauses", () => {
    let nextUrl = 0;
    vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:paused-${++nextUrl}`);
    const audio = document.createElement("audio");
    let paused = true;
    Object.defineProperty(audio, "paused", { configurable: true, get: () => paused });
    Object.defineProperty(audio, "ended", { configurable: true, get: () => false });
    Object.defineProperty(audio, "duration", { configurable: true, get: () => 10 });
    audio.play = vi.fn(async () => { paused = false; });
    audio.load = vi.fn();
    const engine = new AudioEngine(audio, { onStatus: vi.fn(), onBufferChange: vi.fn(), onLevel: vi.fn(), onAudioAvailable: vi.fn() });
    engine.reset("pcm_s16le");
    engine.beginSegment(1);
    engine.push(new Uint8Array([1, 2]).buffer);
    engine.finishSegment(1);
    audio.dispatchEvent(new Event("loadedmetadata"));
    paused = true;
    engine.beginSegment(2);
    engine.push(new Uint8Array([3, 4]).buffer);
    engine.finishSegment(2);
    paused = true;
    audio.dispatchEvent(new Event("pause"));
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.play).toHaveBeenCalledOnce();
    engine.dispose();
  });

  it("keeps unfinished bytes out of live playback but includes them in a terminal snapshot", () => {
    vi.mocked(URL.createObjectURL).mockClear();
    const audio = document.createElement("audio");
    audio.load = vi.fn();
    const engine = new AudioEngine(audio, { onStatus: vi.fn(), onBufferChange: vi.fn(), onLevel: vi.fn(), onAudioAvailable: vi.fn() });
    engine.reset("pcm_s16le");
    engine.beginSegment(1);
    engine.push(new Uint8Array([1, 2, 3, 4]).buffer);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(engine.finalize()?.blob.size).toBe(48);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    engine.dispose();
  });
});

function readBlob(blob: Blob) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as ArrayBuffer));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsArrayBuffer(blob);
  });
}
