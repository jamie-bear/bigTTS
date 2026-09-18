import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import type { ServerEvent } from "../../src/client/types/contracts";
import { NarrationOutput, SegmentFailurePanel, SettingsPanel } from "../../src/client/components/NarrationPanel";
import { createInitialState } from "../../src/client/state/appState";
import { useBigTtsController } from "../../src/client/hooks/useBigTtsController";

const sessionMock = vi.hoisted(() => ({
  events: null as { onEvent: (event: ServerEvent) => void } | null,
  start: vi.fn(), smartRetry: vi.fn(), retry: vi.fn(), skip: vi.fn(), cancel: vi.fn()
}));
vi.mock("../../src/client/services/narrationSession", () => ({
  NarrationSession: class {
    constructor(events: { onEvent: (event: ServerEvent) => void }) { sessionMock.events = events; }
    start = sessionMock.start;
    smartRetrySegment = sessionMock.smartRetry;
    retrySegment = sessionMock.retry;
    skipSegment = sessionMock.skip;
    cancel = sessionMock.cancel;
    dispose() {}
    pause() {}
    resume() {}
  }
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("openrouter/models")
      ? { models: [{ id: "google/gemini-3.1-flash-tts-preview", name: "Gemini", voices: [{ value: "Kore", label: "Kore" }] }] }
      : { voices: [], configured: false, available: false };
    return new Response(JSON.stringify(body), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

it("offers opt-in Auto smart retry for Gemini, remembers it, and sends it with narration", async () => {
  expect(createInitialState().autoSmartRetry).toBe(false);
  const audioRef = { current: null };
  const { result } = renderHook(() => useBigTtsController(audioRef));
  act(() => result.current.actions.selectProvider("openrouter"));
  act(() => {
    result.current.actions.setCredential("key");
    result.current.actions.setText("A sample passage.");
  });
  await waitFor(() => expect(result.current.state.openrouterModel).toContain("gemini"));
  const panel = render(<SettingsPanel controller={result.current} />);
  expect(screen.getByRole("checkbox", { name: "Auto smart retry" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "Auto smart retry" }));
  expect(result.current.state.autoSmartRetry).toBe(true);
  expect(sessionStorage.getItem("openrouterGeminiAutoSmartRetry")).toBe("true");
  expect(createInitialState().autoSmartRetry).toBe(true);
  await act(() => result.current.actions.startNarration());
  expect(sessionMock.start).toHaveBeenLastCalledWith(expect.objectContaining({ options: expect.objectContaining({ autoSmartRetry: true }) }));
  panel.rerender(<SettingsPanel controller={result.current} />);
  expect(screen.getByRole("checkbox", { name: "Auto smart retry" })).toBeDisabled();
  act(() => sessionMock.events?.onEvent({ type: "smartRetryProgress", index: 1, attempts: 7, attemptLimit: 64, totalAttempts: 71, automatic: true, resolvedPieces: 30, skippedPieces: 1 }));
  expect(result.current.state.status).toContain("Auto smart retry: segment 1 · attempt 71");
  act(() => result.current.actions.stopNarration());
  act(() => result.current.actions.selectProvider("gemini"));
  panel.rerender(<SettingsPanel controller={result.current} />);
  expect(screen.queryByRole("checkbox", { name: "Auto smart retry" })).not.toBeInTheDocument();
  act(() => result.current.actions.setCredential("key"));
  await act(() => result.current.actions.startNarration());
  expect(sessionMock.start).toHaveBeenLastCalledWith(expect.objectContaining({ options: expect.objectContaining({ autoSmartRetry: false }) }));
  act(() => result.current.actions.setAutoSmartRetry(false));
  expect(createInitialState().autoSmartRetry).toBe(false);
});

it("shows Smart retry only when the server offers it and explains checkpoint actions", () => {
  const onSmartRetry = vi.fn();
  const failure = { index: 16, totalSegments: 20, message: "Provider returned 400" };
  const props = { failure, onSmartRetry, onRetry: vi.fn(), onSkip: vi.fn() };
  const view = render(<SegmentFailurePanel {...props} />);
  expect(screen.queryByRole("button", { name: "Smart retry" })).not.toBeInTheDocument();
  view.rerender(<SegmentFailurePanel {...props} failure={{ ...failure, smartRetryAvailable: true, smartRetryResumable: true }} />);
  fireEvent.click(screen.getByRole("button", { name: "Smart retry" }));
  expect(onSmartRetry).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Words that still fail are skipped/)).toBeInTheDocument();
  expect(screen.getByText(/Smart retry continues saved progress/)).toHaveTextContent(/Both discard its saved recovery audio/);
});

it("routes Smart retry, shows progress, and retains omission history through stop and completion", async () => {
  const audioRef = { current: null };
  const { result } = renderHook(() => useBigTtsController(audioRef));
  act(() => {
    result.current.actions.selectProvider("openrouter");
    result.current.actions.setCredential("key");
    result.current.actions.setText("A sample passage.");
  });
  // Credential changes use the currently selected provider, after the render.
  act(() => result.current.actions.setCredential("key"));
  await waitFor(() => expect(result.current.state.openrouterModel).toBe("google/gemini-3.1-flash-tts-preview"));
  await act(() => result.current.actions.startNarration());
  const emit = (event: ServerEvent) => act(() => sessionMock.events?.onEvent(event));
  emit({ type: "segmentFailed", index: 16, totalSegments: 20, message: "Rejected", smartRetryAvailable: true });
  act(() => {
    result.current.actions.smartRetryFailedSegment();
    result.current.actions.smartRetryFailedSegment();
  });
  expect(sessionMock.smartRetry).toHaveBeenCalledTimes(1);
  emit({ type: "smartRetryProgress", index: 16, attempts: 7, attemptLimit: 64, resolvedPieces: 3, skippedPieces: 1 });
  expect(result.current.state.status).toContain("segment 16 · attempt 7/64 · 3 pieces recovered");
  emit({ type: "segmentDone", index: 16, totalSegments: 20, omissions: [{ index: 16, text: "missing " }] });
  act(() => result.current.actions.stopNarration());
  const output = render(<NarrationOutput controller={result.current} audioRef={audioRef} />);
  expect(screen.getByText("1 text piece omitted by Smart retry")).toBeInTheDocument();
  expect(screen.getByText("missing")).toBeInTheDocument();
  emit({ type: "complete" });
  expect(result.current.state.status).toContain("completed with 1 omitted text piece");
  output.rerender(<NarrationOutput controller={result.current} audioRef={audioRef} />);
  expect(screen.getByText("1 text piece omitted by Smart retry")).toBeInTheDocument();
  await act(() => result.current.actions.startNarration());
  expect(result.current.state.omissions).toEqual([]);
  output.rerender(<NarrationOutput controller={result.current} audioRef={audioRef} />);
  expect(screen.queryByText("1 text piece omitted by Smart retry")).not.toBeInTheDocument();
});

it("counts omissions even when the entire segment is skipped and completion arrives immediately", async () => {
  const { result } = renderHook(() => useBigTtsController({ current: null }));
  act(() => {
    result.current.actions.selectProvider("gemini");
    result.current.actions.setText("A sample passage.");
  });
  act(() => result.current.actions.setCredential("key"));
  await act(() => result.current.actions.startNarration());
  act(() => {
    sessionMock.events?.onEvent({ type: "segmentSkipped", index: 1, totalSegments: 1, omissions: [{ index: 1, text: "sample" }] });
    sessionMock.events?.onEvent({ type: "complete" });
  });
  expect(result.current.state.status).toContain("completed with 1 omitted text piece");
  expect(result.current.state.omissions).toEqual([{ index: 1, text: "sample" }]);
});
