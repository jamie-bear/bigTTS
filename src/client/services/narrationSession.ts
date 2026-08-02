import type { ClientCommand, ServerEvent, StartNarrationCommand } from "../types/contracts";

interface NarrationSessionEvents {
  onOpen: () => void;
  onEvent: (event: ServerEvent) => void;
  onAudio: (chunk: ArrayBuffer) => void;
  onClose: () => void;
  onError: (message: string) => void;
}

export class NarrationSession {
  private socket: WebSocket | null = null;
  private intentionalClose = false;

  constructor(private readonly events: NarrationSessionEvents) {}

  start(command: StartNarrationCommand) {
    this.dispose();
    this.intentionalClose = false;
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/stream`);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.addEventListener("open", () => {
      this.send(command);
      this.events.onOpen();
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        try { this.events.onEvent(JSON.parse(event.data) as ServerEvent); }
        catch { this.events.onError("The narration server returned an invalid event."); }
      } else {
        this.events.onAudio(event.data as ArrayBuffer);
      }
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket && !this.intentionalClose) this.events.onClose();
    });
    socket.addEventListener("error", () => this.events.onError("Local stream error."));
  }

  cancel() {
    this.intentionalClose = true;
    if (this.socket?.readyState === WebSocket.OPEN) this.send({ type: "cancel" });
    this.socket?.close();
    this.socket = null;
  }

  pause() { this.send({ type: "pause" }); }

  resume() { this.send({ type: "resume" }); }

  retrySegment() { this.send({ type: "retrySegment" }); }

  skipSegment() { this.send({ type: "skipSegment" }); }

  dispose() { this.cancel(); }

  private send(command: ClientCommand) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(command));
  }
}
