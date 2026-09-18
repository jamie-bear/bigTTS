import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import App from "../../src/client/App";
import { useBigTtsController, mergeVoices } from "../../src/client/hooks/useBigTtsController";
import { NarrationSession } from "../../src/client/services/narrationSession";
import { createInitialState } from "../../src/client/state/appState";
import { writeVoiceClones, readVoiceClones } from "../../src/client/services/storage";
import { validateCloneFile } from "../../src/client/services/cloneAudio";
import { PROVIDERS } from "../../src/client/config/providers";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => response({ voices: [], configured: false }))));
afterEach(() => vi.unstubAllGlobals());

it("exposes shared request limits and full MiniMax languages", () => {
  expect(PROVIDERS.resemble.maxSegmentChars).toBe(3000);
  expect(PROVIDERS.minimax.maxSegmentChars).toBe(9999);
  expect(PROVIDERS.minimax.languages).toHaveLength(41);
});

it("gates languages and emotion options when switching MiniMax models", async () => {
  render(<App />);
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "minimax" } });
  fireEvent.click(screen.getByText("Advanced MiniMax settings"));
  fireEvent.change(screen.getByLabelText("MiniMax speech model"), { target: { value: "speech-2.6-hd" } });
  fireEvent.change(screen.getByLabelText("Emotion"), { target: { value: "whisper" } });
  fireEvent.change(screen.getByLabelText("Language"), { target: { value: "Tamil" } });
  fireEvent.change(screen.getByLabelText("MiniMax speech model"), { target: { value: "speech-02-hd" } });
  expect(screen.getByLabelText("Emotion")).toHaveValue("");
  expect(screen.getByLabelText("Language")).toHaveValue("auto");
  expect(screen.getByRole("option", { name: "whisper" })).toBeDisabled();
  expect(screen.getByLabelText("Language").querySelector('option[value="Tamil"]')).toBeDisabled();
  expect(screen.getByLabelText("Reading speed")).toHaveAttribute("min", "0.5");
  expect(screen.getByLabelText("Reading speed")).toHaveAttribute("max", "2");
  expect(screen.getByLabelText("Normalize numbers and abbreviations")).toBeEnabled();
  await act(async () => {});
});

it("persists provider settings separately and sends them through narration", async () => {
  const start = vi.spyOn(NarrationSession.prototype, "start").mockImplementation(() => {});
  const { result } = renderHook(() => useBigTtsController({ current: null }));
  act(() => result.current.actions.selectProvider("minimax"));
  act(() => {
    result.current.actions.setCredential("key"); result.current.actions.setText("Read this."); result.current.actions.setVoiceIdOverride("voice");
    result.current.actions.setMinimaxSettings({ volume: 2, textNormalization: true, pronunciation: "Dr./Doctor" });
  });
  await act(() => result.current.actions.startNarration());
  expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ options: expect.objectContaining({ minimax: expect.objectContaining({ volume: 2, textNormalization: true }) }) }));
  act(() => result.current.actions.selectProvider("resemble"));
  act(() => {
    result.current.actions.setCredential("key"); result.current.actions.setVoiceIdOverride("unknown-id");
    result.current.actions.setResembleSettings({ hd: true, prompt: "Warm", seed: "0" });
  });
  await act(() => result.current.actions.startNarration());
  expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ options: expect.objectContaining({ resemble: expect.objectContaining({ hd: true, prompt: "Warm", seed: "0" }) }) }));
  const loaded = createInitialState();
  expect(loaded.minimaxSettings.volume).toBe(2);
  expect(loaded.resembleSettings.prompt).toBe("Warm");
  sessionStorage.setItem("resembleSynthesisSettings", "bad-json");
  expect(createInitialState().resembleSettings.prompt).toBe("");
});

it("reconciles missing clones without losing local names and persists availability", () => {
  const merged = mergeVoices([{ id: "missing", name: "Local name" }, { id: "exists", name: "My narrator" }], [{ id: "exists", name: "Remote name" }]);
  expect(merged).toEqual([{ id: "missing", name: "Local name", available: false }, { id: "exists", name: "My narrator", available: true }]);
  writeVoiceClones("minimaxVoiceClones", merged);
  expect(readVoiceClones("minimaxVoiceClones")).toEqual(merged);
});

it("keeps failed refreshes from marking saved clones unavailable", async () => {
  writeVoiceClones("minimaxVoiceClones", [{ id: "voice", name: "Voice", available: true }]);
  vi.mocked(fetch).mockImplementation(async (url) => String(url).includes("minimax") ? response({ error: "Unavailable" }, 502) : response({ configured: false }));
  const { result } = renderHook(() => useBigTtsController({ current: null }));
  act(() => result.current.actions.selectProvider("minimax"));
  act(() => result.current.actions.setCredential("key"));
  await act(() => result.current.actions.refreshMinimaxVoices());
  expect(result.current.state.minimaxVoices[0].available).toBe(true);
});

it("shows model-specific pricing and no estimate for unverified legacy rates", async () => {
  const { result } = renderHook(() => useBigTtsController({ current: null }));
  act(() => result.current.actions.selectProvider("minimax"));
  act(() => result.current.actions.setText("a".repeat(10000)));
  expect(result.current.stats.cost).toBe("$1.000 PAYG estimate");
  act(() => result.current.actions.setMinimaxModel("speech-2.8-turbo"));
  expect(result.current.stats.cost).toBe("$0.600 PAYG estimate");
  act(() => result.current.actions.setMinimaxModel("speech-01-hd"));
  expect(result.current.stats.cost).toBe("Estimate unavailable");
  await act(async () => {});
});

it("shows Ultra upgrade guidance and incomplete discovery without blocking unknown IDs", async () => {
  vi.mocked(fetch).mockImplementation(async (url) => response(String(url).includes("resemble") ? { warning: "Discovery incomplete", voices: [{ id: "old", name: "Old voice", available: false, unavailableReason: "Upgrade to Ultra" }] } : { configured: false }));
  render(<App />);
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "resemble" } });
  fireEvent.change(screen.getByLabelText("Resemble.ai API key"), { target: { value: "key" } });
  await waitFor(() => expect(screen.getByText("Discovery incomplete")).toBeVisible());
  expect(screen.getByRole("link", { name: "Open Resemble Voices" })).toBeVisible();
  expect(screen.getByRole("option", { name: "Old voice — unavailable" })).toBeDisabled();
  fireEvent.click(screen.getByText("Resemble delivery settings"));
  expect(screen.getByLabelText("Delivery speed")).toHaveValue("normal");
  expect(screen.queryByLabelText("Reading speed")).not.toBeInTheDocument();
});

it("reads browser recording duration and cleans up resources on success and failure", async () => {
  const audio = document.createElement("audio");
  vi.spyOn(document, "createElement").mockReturnValue(audio);
  Object.defineProperty(audio, "duration", { configurable: true, value: 10 });
  const valid = validateCloneFile(new File(["wav"], "voice.wav"));
  audio.dispatchEvent(new Event("loadedmetadata"));
  await expect(valid).resolves.toBeUndefined();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
  Object.defineProperty(audio, "duration", { value: 8 });
  const invalid = validateCloneFile(new File(["wav"], "prompt.wav"), true);
  audio.dispatchEvent(new Event("loadedmetadata"));
  await expect(invalid).rejects.toThrow("shorter than 8");
  const failed = validateCloneFile(new File(["wav"], "voice.wav"));
  audio.dispatchEvent(new Event("error"));
  await expect(failed).rejects.toThrow("Could not read");
  expect(audio.onloadedmetadata).toBeNull();
  expect(audio.getAttribute("src")).toBeNull();
});

it("shows recording validation failures before narration has started", async () => {
  render(<App />);
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "minimax" } });
  fireEvent.change(screen.getByLabelText("MiniMax API key"), { target: { value: "key" } });
  fireEvent.click(screen.getByText("Custom voice library"));
  fireEvent.click(screen.getByRole("button", { name: "Add new voice" }));
  fireEvent.change(screen.getByLabelText("Voice name"), { target: { value: "Narrator" } });
  fireEvent.change(screen.getByLabelText("Source audio"), { target: { files: [new File(["bad"], "sample.txt")] } });
  fireEvent.click(screen.getByRole("button", { name: "Create voice" }));
  await waitFor(() => expect(screen.getByText(/Choose an MP3, M4A or WAV recording/)).toBeVisible());
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("voices/create"))).toBe(false);
});
