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
    const engine = new AudioEngine(audio, { onStatus: vi.fn(), onAudioAvailable });
    engine.reset("pcm_s16le");
    engine.beginSegment(1);
    engine.push(new Uint8Array([1, 2, 3, 4]).buffer);
    const partial = engine.snapshot();
    expect(onAudioAvailable).toHaveBeenCalledOnce();
    expect(partial?.extension).toBe("wav");
    expect(partial?.blob.size).toBe(48);
    engine.dispose();
  });

  it("reports audio availability once per narration reset", () => {
    const audio = document.createElement("audio");
    audio.load = vi.fn();
    const onAudioAvailable = vi.fn();
    const engine = new AudioEngine(audio, { onStatus: vi.fn(), onAudioAvailable });
    engine.reset("pcm_s16le");
    engine.beginSegment(1);
    engine.push(new Uint8Array([1, 2]).buffer);
    engine.push(new Uint8Array([3, 4]).buffer);
    expect(onAudioAvailable).toHaveBeenCalledOnce();

    engine.reset("pcm_s16le");
    engine.beginSegment(1);
    engine.push(new Uint8Array([5, 6]).buffer);
    expect(onAudioAvailable).toHaveBeenCalledTimes(2);
    engine.dispose();
  });

  it("does not build an MPEG snapshot when a segment completes during MediaSource playback", () => {
    class FakeMediaSource extends EventTarget { static isTypeSupported = () => true; }
    vi.stubGlobal("MediaSource", FakeMediaSource);
    vi.mocked(URL.createObjectURL).mockClear();
    const audio = document.createElement("audio");
    audio.play = vi.fn(async () => undefined);
    const engine = new AudioEngine(audio, { onStatus: vi.fn(), onAudioAvailable: vi.fn() });
    engine.reset("mpeg");
    expect(URL.createObjectURL).toHaveBeenCalledOnce();

    engine.beginSegment(1);
    engine.push(new Uint8Array([1, 2, 3, 4]).buffer);
    engine.finishSegment(1);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    engine.dispose();
    vi.unstubAllGlobals();
  });

  it.each(["pcm_s16le", "mpeg"] as const)("stages cumulative %s updates until the current playback reaches its endpoint", (encoding) => {
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
    const engine = new AudioEngine(audio, { onStatus: vi.fn(), onAudioAvailable: vi.fn() });
    engine.reset(encoding);

    engine.beginSegment(1);
    engine.push(new Uint8Array([1, 2, 3, 4]).buffer);
    engine.finishSegment(1);
    expect(engine.snapshot()?.blob.size).toBe(encoding === "mpeg" ? 4 : 48);
    expect(audio.src).toContain("blob:pcm-1");
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.play).toHaveBeenCalledOnce();

    audio.currentTime = 1.5;
    engine.beginSegment(2);
    engine.push(new Uint8Array([5, 6, 7, 8]).buffer);
    engine.finishSegment(2);
    expect(engine.snapshot()?.blob.size).toBe(encoding === "mpeg" ? 8 : 52);
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

  it.each(["pcm_s16le", "mpeg"] as const)("does not autoplay a cumulative %s update after the listener manually pauses", (encoding) => {
    let nextUrl = 0;
    vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:paused-${++nextUrl}`);
    const audio = document.createElement("audio");
    let paused = true;
    Object.defineProperty(audio, "paused", { configurable: true, get: () => paused });
    Object.defineProperty(audio, "ended", { configurable: true, get: () => false });
    Object.defineProperty(audio, "duration", { configurable: true, get: () => 10 });
    audio.play = vi.fn(async () => { paused = false; });
    audio.load = vi.fn();
    const engine = new AudioEngine(audio, { onStatus: vi.fn(), onAudioAvailable: vi.fn() });
    engine.reset(encoding);
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
    const engine = new AudioEngine(audio, { onStatus: vi.fn(), onAudioAvailable: vi.fn() });
    engine.reset("pcm_s16le");
    engine.beginSegment(1);
    engine.push(new Uint8Array([1, 2, 3, 4]).buffer);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(engine.finalize()?.blob.size).toBe(48);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    engine.dispose();
  });
});

describe("MPEG playback compatibility", () => {
  class FakeSourceBuffer extends EventTarget {
    mode = "segments";
    updating = false;
    buffered = { length: 0 };
    appendBuffer = vi.fn();
  }
  class FakeMediaSource extends EventTarget {
    static isTypeSupported = vi.fn(() => true);
    readyState = "open";
    buffer = new FakeSourceBuffer();
    addSourceBuffer = vi.fn(() => this.buffer);
    endOfStream = vi.fn();
  }

  let audio: HTMLAudioElement;
  let engine: AudioEngine;
  beforeEach(() => {
    let nextUrl = 0;
    vi.mocked(URL.createObjectURL).mockReset().mockImplementation(() => `blob:compat-${++nextUrl}`);
    vi.mocked(URL.revokeObjectURL).mockClear();
    FakeMediaSource.isTypeSupported.mockReset().mockReturnValue(true);
    vi.stubGlobal("MediaSource", FakeMediaSource);
    audio = document.createElement("audio");
    audio.load = vi.fn();
    audio.play = vi.fn(async () => undefined);
    engine = new AudioEngine(audio, { onStatus: vi.fn(), onAudioAvailable: vi.fn() });
  });
  afterEach(() => {
    engine.dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const finishSegment = () => {
    engine.beginSegment(1);
    engine.push(new Uint8Array([1, 2, 3, 4]).buffer);
    engine.finishSegment(1);
  };
  const currentMediaSource = () => vi.mocked(URL.createObjectURL).mock.calls[0][0] as unknown as FakeMediaSource;

  it.each(["unsupported", "missing", "missing capability check", "constructor throws"])("plays the first completed MP3 when MediaSource is %s", (scenario) => {
    if (scenario === "unsupported") FakeMediaSource.isTypeSupported.mockReturnValue(false);
    if (scenario === "missing") vi.stubGlobal("MediaSource", undefined);
    if (scenario === "missing capability check") vi.stubGlobal("MediaSource", class {});
    if (scenario === "constructor throws") vi.stubGlobal("MediaSource", class extends FakeMediaSource {
      constructor() { super(); throw new Error("Unavailable"); }
    });
    engine.reset("mpeg");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    engine.beginSegment(1);
    engine.push(new Uint8Array([1, 2, 3, 4]).buffer);
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.getAttribute("src")).toBeNull();
    engine.finishSegment(1);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("audio/mpeg");
    expect(blob.size).toBe(4);
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.play).toHaveBeenCalledOnce();
    expect(engine.complete()?.extension).toBe("mp3");
  });

  it.each([false, true])("recovers from SourceBuffer setup failure with completed audio=%s", (alreadyCompleted) => {
    engine.reset("mpeg");
    const source = currentMediaSource();
    source.addSourceBuffer.mockImplementation(() => { throw new Error("Unsupported type"); });
    if (alreadyCompleted) finishSegment();
    source.dispatchEvent(new Event("sourceopen"));
    if (!alreadyCompleted) finishSegment();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(audio.src).toBe("blob:compat-2");
    vi.mocked(audio.play).mockClear();
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.play).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:compat-1");
    expect(engine.snapshot()?.blob.size).toBe(4);
  });

  it("keeps supported MPEG streaming and drains bytes queued before sourceopen", () => {
    engine.reset("mpeg");
    const source = currentMediaSource();
    finishSegment();
    source.dispatchEvent(new Event("sourceopen"));
    expect(FakeMediaSource.isTypeSupported).toHaveBeenCalledWith("audio/mpeg");
    expect(source.addSourceBuffer).toHaveBeenCalledWith("audio/mpeg");
    expect(source.buffer.mode).toBe("sequence");
    expect(source.buffer.appendBuffer).toHaveBeenCalledWith(new Uint8Array([1, 2, 3, 4]).buffer);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });

  it.each(["reset", "dispose", "configure"] as const)("ignores a late sourceopen after %s", (action) => {
    engine.reset("mpeg");
    const oldSource = currentMediaSource();
    if (action === "configure") engine.configure("pcm_s16le", 24000, 1);
    else engine[action]();
    oldSource.dispatchEvent(new Event("sourceopen"));
    expect(oldSource.addSourceBuffer).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:compat-1");
    if (action === "reset") {
      const newSource = vi.mocked(URL.createObjectURL).mock.calls[1][0] as unknown as FakeMediaSource;
      newSource.dispatchEvent(new Event("sourceopen"));
      expect(newSource.addSourceBuffer).toHaveBeenCalledOnce();
    }
  });

  it("keeps a manually paused stream paused as chunks arrive and generation completes", () => {
    engine.reset("mpeg");
    currentMediaSource().dispatchEvent(new Event("sourceopen"));
    finishSegment();
    expect(audio.play).toHaveBeenCalledOnce();
    audio.dispatchEvent(new Event("play"));
    audio.dispatchEvent(new Event("pause"));
    engine.beginSegment(2);
    engine.push(new Uint8Array([5, 6]).buffer);
    engine.finishSegment(2);
    engine.complete();
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it("resumes a stream at its generated endpoint when another segment arrives", () => {
    engine.reset("mpeg");
    currentMediaSource().dispatchEvent(new Event("sourceopen"));
    finishSegment();
    audio.dispatchEvent(new Event("play"));
    Object.defineProperty(audio, "ended", { configurable: true, value: true });
    engine.beginSegment(2);
    engine.push(new Uint8Array([5, 6]).buffer);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending stream completion when a new narration starts", () => {
    vi.useFakeTimers();
    engine.reset("mpeg");
    const oldSource = currentMediaSource();
    oldSource.dispatchEvent(new Event("sourceopen"));
    finishSegment();
    oldSource.buffer.updating = true;
    Object.defineProperty(audio, "paused", { configurable: true, value: false });
    engine.complete();
    expect(vi.getTimerCount()).toBe(1);
    engine.reset("mpeg");
    const newSource = vi.mocked(URL.createObjectURL).mock.calls[1][0] as unknown as FakeMediaSource;
    newSource.dispatchEvent(new Event("sourceopen"));
    vi.runAllTimers();
    expect(oldSource.endOfStream).not.toHaveBeenCalled();
    expect(newSource.endOfStream).not.toHaveBeenCalled();
  });

  it("does not autoplay stale snapshot metadata after reset", () => {
    FakeMediaSource.isTypeSupported.mockReturnValue(false);
    engine.reset("mpeg");
    finishSegment();
    engine.reset("mpeg");
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.play).not.toHaveBeenCalled();
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
