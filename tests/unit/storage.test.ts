import { readCredentials, readProvider, readVoiceClones, writeCredential, writeVoiceClones } from "../../src/client/services/storage";

describe("storage compatibility", () => {
  it("keeps the established provider and credential keys", () => {
    sessionStorage.setItem("ttsProvider", "xai");
    sessionStorage.setItem("xaiApiKey", "xai-test");
    expect(readProvider()).toBe("xai");
    expect(readCredentials().xai).toBe("xai-test");
    writeCredential("xai", "replacement", true);
    expect(sessionStorage.getItem("xaiApiKey")).toBe("replacement");
  });

  it("round-trips local clone metadata and tolerates invalid JSON", () => {
    writeVoiceClones("minimaxVoiceClones", [{ id: "voice-1", name: "Narrator" }]);
    expect(readVoiceClones("minimaxVoiceClones")).toEqual([{ id: "voice-1", name: "Narrator" }]);
    localStorage.setItem("minimaxVoiceClones", "not-json");
    expect(readVoiceClones("minimaxVoiceClones")).toEqual([]);
  });

  it("tolerates legacy clone records and removes unused metadata when persisted", () => {
    localStorage.setItem("minimaxVoiceClones", JSON.stringify([{
      id: "voice-1",
      name: "Narrator",
      model: "speech-2.8-hd",
      previewAudio: "obsolete",
      providerResponse: { unused: true }
    }]));

    const voices = readVoiceClones("minimaxVoiceClones");
    expect(voices).toEqual([{ id: "voice-1", name: "Narrator", model: "speech-2.8-hd" }]);
    writeVoiceClones("minimaxVoiceClones", voices);
    expect(JSON.parse(localStorage.getItem("minimaxVoiceClones") || "[]")).toEqual(voices);
  });
});
