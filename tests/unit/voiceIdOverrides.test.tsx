import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import App from "../../src/client/App";
import { useBigTtsController } from "../../src/client/hooks/useBigTtsController";
import { NarrationSession } from "../../src/client/services/narrationSession";

const providers = ["resemble", "minimax"] as const;
const voices = [{ id: "Library-One", name: "First narrator" }, { id: "Library-Two", name: "Second narrator" }];
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

describe("voice ID overrides", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ voices: [], configured: false, connected: false })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(providers)("uses the %s override before the dropdown, trims it, and falls back when cleared", async (provider) => {
    const start = vi.spyOn(NarrationSession.prototype, "start").mockImplementation(() => {});
    const audioRef = { current: null };
    const { result } = renderHook(() => useBigTtsController(audioRef));
    act(() => result.current.actions.selectProvider(provider));
    act(() => {
      result.current.actions.setCredential("test-key");
      result.current.actions.setText("Read this sentence.");
      result.current.actions.setVoice("Library-One");
      result.current.actions.setVoiceIdOverride("  Custom-Voice_AbC  ");
    });
    act(() => result.current.actions.setVoice("Library-Two"));
    await act(() => result.current.actions.startNarration());
    expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ options: expect.objectContaining({ provider, voice: "Custom-Voice_AbC" }) }));
    for (const value of ["", "   "]) {
      act(() => result.current.actions.setVoiceIdOverride(value));
      await act(() => result.current.actions.startNarration());
      expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ options: expect.objectContaining({ voice: "Library-Two" }) }));
    }
    act(() => result.current.actions.setVoice(""));
    await act(() => result.current.actions.startNarration());
    expect(result.current.state.status).toBe("Select a custom voice or enter a voice ID before starting narration.");
    expect(start).toHaveBeenCalledTimes(3);
  });

  it.each(providers)("preserves the %s ID while delayed voice discovery finishes", async (provider) => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(async (input) => String(input).endsWith(`/api/${provider}/voices`)
      ? new Promise<Response>((resolve) => { finish = resolve; })
      : json({ configured: false, connected: false }));
    const start = vi.spyOn(NarrationSession.prototype, "start").mockImplementation(() => {});
    render(<App />);
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: provider } });
    fireEvent.change(screen.getByLabelText(/API key/), { target: { value: "test-key" } });
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    fireEvent.change(screen.getByLabelText(/Voice ID/), { target: { value: "  External-AbC  " } });
    await act(async () => finish(json({ voices })));
    await waitFor(() => expect(screen.getByLabelText("Voice")).toHaveValue("Library-One"));
    fireEvent.change(screen.getByLabelText("Voice"), { target: { value: "Library-Two" } });
    expect(screen.getByLabelText(/Voice ID/)).toHaveValue("  External-AbC  ");
    fireEvent.change(screen.getByLabelText("Book or chapter text"), { target: { value: "Read this." } });
    fireEvent.click(screen.getByRole("button", { name: "Start narration" }));
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ voice: "External-AbC" }) }));
  });

  it.each(providers.flatMap((provider) => [false, true].map((fails) => ({ provider, fails }))))("narrates with $provider ID when discovery fails=$fails or returns no voices", async ({ provider, fails }) => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith(`/api/${provider}/voices`) && fails) return new Response(JSON.stringify({ error: "Discovery unavailable" }), { status: 502 });
      return json({ voices: [], configured: false, connected: false });
    });
    const start = vi.spyOn(NarrationSession.prototype, "start").mockImplementation(() => {});
    const audioRef = { current: null };
    const { result } = renderHook(() => useBigTtsController(audioRef));
    act(() => result.current.actions.selectProvider(provider));
    act(() => {
      result.current.actions.setCredential("test-key");
      result.current.actions.setText("Read this.");
      result.current.actions.setVoiceIdOverride("819fcc57");
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/${provider}/voices`, expect.anything()));
    if (fails) await waitFor(() => expect(result.current.state.status).toContain("discovery failed"));
    await act(() => result.current.actions.startNarration());
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ voice: "819fcc57" }) }));
  });

  it("keeps provider IDs separate across switches and reloads, and removes cleared session values", async () => {
    const app = render(<App />);
    expect(screen.queryByLabelText(/Voice ID/)).not.toBeInTheDocument();
    for (const provider of providers) {
      fireEvent.change(screen.getByLabelText("Provider"), { target: { value: provider } });
      expect(screen.getByLabelText(/Voice ID/)).toHaveValue("");
      fireEvent.change(screen.getByLabelText(/Voice ID/), { target: { value: `${provider}-ID` } });
      expect(sessionStorage.getItem(`${provider}VoiceIdOverride`)).toBe(`${provider}-ID`);
      expect(localStorage.getItem(`${provider}VoiceIdOverride`)).toBeNull();
    }
    app.unmount();
    const reloaded = render(<App />);
    for (const provider of providers) {
      fireEvent.change(screen.getByLabelText("Provider"), { target: { value: provider } });
      expect(screen.getByLabelText(/Voice ID/)).toHaveValue(`${provider}-ID`);
      fireEvent.change(screen.getByLabelText(/Voice ID/), { target: { value: "" } });
      expect(sessionStorage.getItem(`${provider}VoiceIdOverride`)).toBeNull();
    }
    for (const provider of ["xai", "gemini", "openrouter"]) {
      fireEvent.change(screen.getByLabelText("Provider"), { target: { value: provider } });
      expect(screen.queryByLabelText(/Voice ID/)).not.toBeInTheDocument();
    }
    reloaded.unmount();
    render(<App />);
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "resemble" } });
    expect(screen.getByLabelText(/Voice ID/)).toHaveValue("");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  it("keeps MiniMax refresh, rename, delete, and creation tied to the library without replacing the override", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/voices/create")) return json({ voice: { id: "New-Clone", name: "New narrator" } });
      if (url.endsWith("/voices/delete")) return json({ ok: true });
      return json({ voices, configured: false, connected: false });
    });
    const audioRef = { current: null };
    const { result } = renderHook(() => useBigTtsController(audioRef));
    act(() => result.current.actions.selectProvider("minimax"));
    act(() => {
      result.current.actions.setCredential("test-key");
      result.current.actions.setVoiceIdOverride("External-ID");
    });
    await waitFor(() => expect(result.current.state.voice).toBe("Library-One"));
    await act(() => result.current.actions.refreshMinimaxVoices());
    act(() => result.current.actions.renameMinimaxClone("Library-One", "Renamed narrator"));
    expect(result.current.state.minimaxVoices[0].name).toBe("Renamed narrator");
    await act(() => result.current.actions.deleteMinimaxClone());
    expect(fetch).toHaveBeenCalledWith("/api/minimax/voices/delete", expect.objectContaining({ body: JSON.stringify({ apiKey: "test-key", voiceId: "Library-One" }) }));
    await act(() => result.current.actions.saveMinimaxClone({ name: "New narrator", languageModel: "auto", promptText: "", validationText: "", source: new File(["audio"], "sample.wav", { type: "audio/wav" }) }));
    expect(result.current.state.voice).toBe("New-Clone");
    expect(result.current.state.voiceIdOverrides.minimax).toBe("External-ID");
    expect(sessionStorage.getItem("minimaxVoiceIdOverride")).toBe("External-ID");
    expect(result.current.state.minimaxVoices.some(({ id }) => id === "External-ID")).toBe(false);
  });
});
