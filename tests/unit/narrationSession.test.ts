import { vi } from "vitest";
import { NarrationSession } from "../../src/client/services/narrationSession";
import type { StartNarrationCommand } from "../../src/client/types/contracts";

class MockWebSocket extends EventTarget {
  static OPEN = 1;
  static instance: MockWebSocket;
  readyState = MockWebSocket.OPEN;
  binaryType = "";
  sent: string[] = [];
  constructor(readonly url: string) { super(); MockWebSocket.instance = this; }
  send(value: string) { this.sent.push(value); }
  close() { this.dispatchEvent(new CloseEvent("close")); }
}

const command: StartNarrationCommand = {
  type: "start",
  apiKey: "test-key",
  text: "Hello",
  options: {
    provider: "xai", voice: "eve", language: "auto", speed: 1, segmentChars: 4500,
    optimizeStreamingLatency: true, textNormalization: false, model: "",
    geminiContinuity: false, geminiNarratorDirection: ""
  }
};

describe("NarrationSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("serializes start and telemetry commands and routes server events", () => {
    const onEvent = vi.fn();
    const session = new NarrationSession({ onOpen: vi.fn(), onEvent, onAudio: vi.fn(), onClose: vi.fn(), onError: vi.fn() });
    session.start(command, () => ({ paused: false, bufferedAheadSeconds: 2 }));
    const socket = MockWebSocket.instance;
    socket.dispatchEvent(new Event("open"));
    expect(JSON.parse(socket.sent[0])).toEqual(command);
    vi.advanceTimersByTime(1_000);
    expect(JSON.parse(socket.sent[1])).toEqual({ type: "telemetry", paused: false, bufferedAheadSeconds: 2 });
    socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "status", message: "Ready" }) }));
    expect(onEvent).toHaveBeenCalledWith({ type: "status", message: "Ready" });
    session.dispose();
  });

  it("does not report an intentional cancellation as an unexpected close", () => {
    const onClose = vi.fn();
    const session = new NarrationSession({ onOpen: vi.fn(), onEvent: vi.fn(), onAudio: vi.fn(), onClose, onError: vi.fn() });
    session.start(command, () => ({ paused: true, bufferedAheadSeconds: 0 }));
    MockWebSocket.instance.dispatchEvent(new Event("open"));
    session.cancel();
    expect(JSON.parse(MockWebSocket.instance.sent.at(-1) || "{}")).toEqual({ type: "cancel" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("sends pause, resume, retry, and skip commands without closing the session", () => {
    const session = new NarrationSession({ onOpen: vi.fn(), onEvent: vi.fn(), onAudio: vi.fn(), onClose: vi.fn(), onError: vi.fn() });
    session.start(command, () => ({ paused: false, bufferedAheadSeconds: 0 }));
    MockWebSocket.instance.dispatchEvent(new Event("open"));
    session.pause();
    session.resume();
    session.retrySegment();
    session.skipSegment();
    expect(MockWebSocket.instance.sent.slice(-4).map((value) => JSON.parse(value))).toEqual([
      { type: "pause" },
      { type: "resume" },
      { type: "retrySegment" },
      { type: "skipSegment" }
    ]);
    expect(MockWebSocket.instance.readyState).toBe(MockWebSocket.OPEN);
    session.dispose();
  });
});
