import { describe, expect, it } from "vitest";
import { buildMiniMaxVoiceClonePayload } from "../../src/server.js";

describe("MiniMax voice-clone payload", () => {
  it("forwards the optional source transcript without requesting a billed preview", () => {
    const payload = buildMiniMaxVoiceClonePayload({
      sourceFileId: "123",
      voiceId: "narrator",
      languageModel: "English",
      validationText: `  ${"a".repeat(220)}  `
    });

    expect(payload).toMatchObject({
      file_id: 123,
      voice_id: "narrator",
      language_boost: "English",
      text_validation: "a".repeat(200)
    });
    expect(payload).not.toHaveProperty("text");
  });

  it("omits validation and prompt fields when they are not supplied", () => {
    const payload = buildMiniMaxVoiceClonePayload({ sourceFileId: "file-1", voiceId: "narrator" });
    expect(payload).not.toHaveProperty("text_validation");
    expect(payload).not.toHaveProperty("clone_prompt");
  });

  it("rejects prompt audio and transcript inputs that are not paired", () => {
    expect(() => buildMiniMaxVoiceClonePayload({
      sourceFileId: "file-1",
      voiceId: "narrator",
      promptFileId: "prompt-1"
    })).toThrow("MiniMax prompt audio and prompt text must be provided together.");
  });
});
