import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import App from "../../src/client/App";

describe("bigTTS application shell", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("google-oauth/status")) return new Response(JSON.stringify({ configured: false, connected: false }), { status: 200 });
      if (url.includes("provider/balance")) return new Response(JSON.stringify({ available: true, amount: 12.34, currency: "USD", updatedAt: "2026-07-14T10:00:00.000Z" }), { status: 200 });
      return new Response(JSON.stringify({ models: [], voices: [] }), { status: 200 });
    }));
  });

  it("renders the current hierarchy and all supported providers", async () => {
    render(<App />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "bigTTS home" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Gemini Developer API — API key" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Google Cloud TTS — OAuth" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start narration" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Pause generation" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
  });

  it("explains Google access routes and renders voice gender as provider-backed text", async () => {
    render(<App />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "gemini" } });
    expect(screen.getByText(/Developer API, using an AI Studio API key/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Enceladus — Breathy — Male" })).toBeInTheDocument();
    expect(screen.queryByText(/♀|♂|⚥/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "google" } });
    expect(screen.getByText(/Google Cloud Text-to-Speech, using Google OAuth/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "xai" } });
    expect(screen.getByRole("option", { name: "Sal — Neutral" })).toBeInTheDocument();
  });

  it("loads and clears the sample while updating text statistics", async () => {
    render(<App />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Use sample" }));
    expect((screen.getByLabelText("Book or chapter text") as HTMLTextAreaElement).value).toContain("Chapter One");
    expect(screen.getByLabelText("Text statistics")).not.toHaveTextContent("0characters");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByLabelText("Book or chapter text")).toHaveValue("");
  });

  it("switches provider capabilities and explains unavailable settings", async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "xai" } });
    expect(screen.getByLabelText("Optimize first audio chunk")).toBeInTheDocument();
    expect(screen.getByLabelText("Normalize numbers and abbreviations")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "google" } });
    expect(screen.getByLabelText("Optimize first audio chunk")).toBeDisabled();
    expect(screen.getByLabelText("Normalize numbers and abbreviations")).toBeDisabled();
    const unavailableOptions = screen.getByText("Unavailable options").closest("details");
    expect(unavailableOptions).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Unavailable options"));
    expect(unavailableOptions).toHaveAttribute("open");
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText("Google OAuth is not configured")).toBeInTheDocument());
  });

  it("shows either the API key editor or the saved-session control", async () => {
    render(<App />);
    const input = screen.getByLabelText("OpenRouter API key");
    expect(input).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: /OpenRouter API key kept/ })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "test-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Keep for session" }));
    const remembered = screen.getByRole("checkbox", { name: /OpenRouter API key kept/ });
    expect(remembered).toBeChecked();
    expect(screen.queryByLabelText("OpenRouter API key")).not.toBeInTheDocument();
    fireEvent.click(remembered);
    expect(screen.getByLabelText("OpenRouter API key")).toHaveValue("test-key");
    expect(screen.queryByRole("checkbox", { name: /OpenRouter API key kept/ })).not.toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 500)); });
  });

  it("shows an available provider balance without exposing voice-clone controls", async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("OpenRouter API key"), { target: { value: "test-key" } });
    await waitFor(() => expect(screen.getByLabelText("Provider balance")).toHaveTextContent("12.34"), { timeout: 1500 });
    expect(screen.queryByText("Manage voice clones")).not.toBeInTheDocument();
  });

  it("hides the provider balance when the API does not expose an amount", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("google-oauth/status")) return new Response(JSON.stringify({ configured: false, connected: false }), { status: 200 });
      if (url.includes("provider/balance")) return new Response(JSON.stringify({ available: false, message: "Balance unavailable", updatedAt: new Date().toISOString() }), { status: 200 });
      return new Response(JSON.stringify({ models: [], voices: [] }), { status: 200 });
    });
    render(<App />);
    fireEvent.change(screen.getByLabelText("OpenRouter API key"), { target: { value: "test-key" } });

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("provider/balance"), expect.anything()), { timeout: 1500 });
    expect(screen.queryByLabelText("Provider balance")).not.toBeInTheDocument();
    expect(screen.queryByText("Balance unavailable")).not.toBeInTheDocument();
  });

  it("shows and persists advanced continuity controls for OpenRouter Gemini 3.1 only", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("google-oauth/status")) return new Response(JSON.stringify({ configured: false, connected: false }), { status: 200 });
      if (url.includes("provider/balance")) return new Response(JSON.stringify({ available: false, updatedAt: new Date().toISOString() }), { status: 200 });
      if (url.includes("openrouter/models")) return new Response(JSON.stringify({ models: [{ id: "google/gemini-3.1-flash-tts-preview", name: "Gemini 3.1 Flash TTS Preview", voices: [{ value: "Kore", label: "Kore" }] }] }), { status: 200 });
      return new Response(JSON.stringify({ voices: [] }), { status: 200 });
    });
    render(<App />);
    fireEvent.change(screen.getByLabelText("OpenRouter API key"), { target: { value: "test-key" } });
    await waitFor(() => expect(screen.getByLabelText("OpenRouter model")).toHaveValue("google/gemini-3.1-flash-tts-preview"), { timeout: 1500 });
    expect(screen.getByLabelText("Segment target")).toHaveValue("500");
    expect(screen.getByRole("option", { name: "Long" })).toBeDisabled();
    const enhanced = screen.getByLabelText("Enhanced continuity");
    expect(enhanced).toBeChecked();
    fireEvent.click(enhanced);
    fireEvent.change(screen.getByLabelText(/Narrator direction/), { target: { value: "Warm and restrained." } });
    expect(sessionStorage.getItem("openrouterGeminiContinuity")).toBe("false");
    expect(sessionStorage.getItem("openrouterGeminiNarratorDirection")).toBe("Warm and restrained.");
  });

  it("keeps MiniMax voice management inside Voice & synthesis with distinct add, rename, and delete flows", async () => {
    localStorage.setItem("minimaxVoiceClones", JSON.stringify([{ id: "narrator-1", name: "Original narrator", model: "speech-2.8-hd" }]));
    render(<App />);
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "minimax" } });

    const libraryLabel = await screen.findByText("Custom voice library");
    const library = libraryLabel.closest("details");
    const voiceSection = screen.getByRole("heading", { name: "Voice & synthesis" }).closest("section");
    const providerSection = screen.getByRole("heading", { name: "Provider & access" }).closest("section");
    expect(voiceSection).toContainElement(library);
    expect(providerSection).not.toContainElement(library);

    fireEvent.click(libraryLabel);
    await waitFor(() => expect(screen.getByText("Original narrator")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "Studio narrator" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(screen.getByRole("option", { name: "Studio narrator (speech-2.8-hd)" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/permanently removes the voice/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add new voice" }));
    expect(screen.getByLabelText("Voice name")).toBeInTheDocument();
    expect(screen.getByLabelText("Source audio")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create voice" })).toBeInTheDocument();
  });
});
