import { expect, test, type Page } from "@playwright/test";

async function mockBaseApis(page: Page) {
  let balanceRequests = 0;
  await page.route("**/api/google-oauth/status", (route) => route.fulfill({ json: { configured: true, connected: true, updatedAt: "2026-07-13T12:00:00.000Z" } }));
  await page.route("**/api/openrouter/models", (route) => route.fulfill({ json: { models: [{ id: "mistral/voxtral-mini-tts", name: "Voxtral Mini TTS", voices: [{ value: "alloy", label: "Alloy" }] }] } }));
  await page.route("**/api/provider/balance", (route) => route.fulfill({ json: { available: true, amount: 10 - balanceRequests++, currency: "USD", updatedAt: new Date().toISOString() } }));
  await page.route("**/api/resemble/voices", (route) => route.fulfill({ json: { voices: [{ id: "resemble-voice", name: "Resemble Narrator" }] } }));
  await page.route("**/api/minimax/voices", (route) => route.fulfill({ json: { voices: [{ id: "minimax-voice", name: "MiniMax Narrator", model: "speech-2.8-hd" }] } }));
}

test.beforeEach(async ({ page, context }) => {
  await context.routeWebSocket(/\/stream$/, (socket) => {
    let narrationText = "";
    socket.onMessage((message) => {
      const command = JSON.parse(String(message));
      if (command.type === "pause" && narrationText === "pause-flow") {
        socket.send(JSON.stringify({ type: "pausePending", currentSegment: 1, totalSegments: 2 }));
        socket.send(JSON.stringify({ type: "segmentDone", index: 1, totalSegments: 2 }));
        socket.send(JSON.stringify({ type: "paused", completedSegments: 1, totalSegments: 2 }));
        return;
      }
      if (command.type === "resume" && narrationText === "pause-flow") {
        socket.send(JSON.stringify({ type: "resumed", nextSegment: 2, totalSegments: 2 }));
        socket.send(JSON.stringify({ type: "segment", index: 2, totalSegments: 2 }));
        socket.send(Buffer.from([0xff, 0xfb, 0x90, 0x65]));
        socket.send(JSON.stringify({ type: "segmentDone", index: 2, totalSegments: 2 }));
        socket.send(JSON.stringify({ type: "complete" }));
        return;
      }
      if (command.type === "retrySegment" && narrationText === "recovery-flow") {
        socket.send(JSON.stringify({ type: "segmentRetrying", index: 2, totalSegments: 2 }));
        socket.send(JSON.stringify({ type: "segment", index: 2, totalSegments: 2 }));
        socket.send(Buffer.from([0xff, 0xfb, 0x90, 0x65]));
        socket.send(JSON.stringify({ type: "segmentDone", index: 2, totalSegments: 2, generationId: "gen-retried", attempts: 1 }));
        socket.send(JSON.stringify({ type: "complete" }));
        return;
      }
      if (command.type === "start") {
        narrationText = command.text;
        if (command.text === "inspect-gemini-options") {
          socket.send(JSON.stringify({ type: "status", message: `continuity=${command.options.geminiContinuity}; direction=${command.options.geminiNarratorDirection}` }));
          return;
        }
        const totalSegments = command.text === "pause-flow" || command.text === "recovery-flow" ? 2 : 1;
        socket.send(JSON.stringify({ type: "meta", provider: command.options.provider, audioEncoding: "mpeg", sampleRate: 24000, channels: 1, totalChars: 11, totalSegments, segmentChars: command.options.segmentChars }));
        socket.send(JSON.stringify({ type: "segment", index: 1, totalSegments }));
        socket.send(Buffer.from([0xff, 0xfb, 0x90, 0x64]));
        if (command.text === "partial" || command.text === "pause-flow") return;
        if (command.text === "recovery-flow") {
          socket.send(JSON.stringify({ type: "segmentDone", index: 1, totalSegments: 2 }));
          socket.send(JSON.stringify({ type: "segment", index: 2, totalSegments: 2 }));
          socket.send(JSON.stringify({
            type: "segmentFailed",
            index: 2,
            totalSegments: 2,
            message: "OpenRouter TTS request failed: Provider returned 400",
            details: { status: 400, errorType: "content_policy_violation", providerCode: "PROHIBITED_CONTENT", requestId: "req-123", attempts: 1 }
          }));
          return;
        }
        socket.send(JSON.stringify({ type: "segmentDone", index: 1, totalSegments: 1 }));
        socket.send(JSON.stringify({ type: "complete" }));
      }
    });
  });
  await mockBaseApis(page);
  await page.goto("/");
});

test("keeps the desktop and mobile shells free of horizontal page overflow", async ({ page }) => {
  await expect(page.getByRole("link", { name: "bigTTS home" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("alternates between API key entry and the saved-session control", async ({ page }) => {
  const keyInput = page.locator("#apiKey");
  await keyInput.fill("test-key");
  await page.getByRole("button", { name: "Keep for session" }).click();
  await expect(keyInput).toBeHidden();
  const saved = page.getByRole("checkbox", { name: "OpenRouter API key kept for this browser session" });
  await expect(saved).toBeChecked();
  await saved.click();
  await expect(keyInput).toBeVisible();
  await expect(saved).toBeHidden();
});

test("keeps unsupported synthesis options collapsed by default", async ({ page }) => {
  const languageBox = await page.getByLabel("Language", { exact: true }).boundingBox();
  const segmentBox = await page.getByLabel("Segment size", { exact: true }).boundingBox();
  expect(languageBox).not.toBeNull();
  expect(segmentBox).not.toBeNull();
  if ((page.viewportSize()?.width || 0) > 600) expect(Math.abs(languageBox!.y - segmentBox!.y)).toBeLessThan(1);
  expect(Math.abs(languageBox!.height - segmentBox!.height)).toBeLessThan(1);

  const unavailable = page.locator("details.unavailable-capabilities");
  await expect(unavailable).not.toHaveAttribute("open", "");
  await expect(page.getByLabel("Optimize first audio chunk")).toBeHidden();
  await unavailable.getByText("Unavailable options").click();
  await expect(page.getByLabel("Optimize first audio chunk")).toBeVisible();
});

test("matches the visual-parity baseline", async ({ page }) => {
  await expect(page.getByRole("link", { name: "bigTTS home" })).toBeVisible();
  await expect(page).toHaveScreenshot("app-shell.png", {
    fullPage: true,
    animations: "disabled",
    maxDiffPixelRatio: 0.002
  });
});

test("pins a dark theme from the header toggle", async ({ page }) => {
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  await page.getByRole("button", { name: "Theme: System" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Theme: Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page).toHaveScreenshot("app-shell-dark.png", {
    fullPage: true,
    animations: "disabled",
    maxDiffPixelRatio: 0.002
  });
});

for (const provider of ["openrouter", "minimax", "xai", "gemini", "google", "resemble"] as const) {
  test(`${provider} retains its provider-specific controls`, async ({ page }) => {
    await page.getByLabel("Provider", { exact: true }).selectOption(provider);
    if (provider !== "google") await page.locator("#apiKey").fill("test-key");
    if (provider === "openrouter") await expect(page.getByLabel("OpenRouter model")).toBeEnabled();
    if (provider === "minimax") await expect(page.getByLabel("MiniMax speech model")).toBeVisible();
    if (provider === "google") await expect(page.getByText("Google connected")).toBeVisible();
    if (provider === "xai") await expect(page.getByLabel("Normalize numbers and abbreviations")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start narration" })).toBeEnabled();
  });
}

test("mocked WebSocket events drive narration progress and completion", async ({ page }) => {
  await page.getByLabel("Provider", { exact: true }).selectOption("xai");
  await page.getByLabel("xAI API key").fill("test-key");
  await page.getByLabel("Book or chapter text").fill("Hello world");
  await page.getByRole("button", { name: "Start narration" }).click();
  await expect(page.getByText("1 / 1 segments")).toBeVisible();
  await expect(page.getByText("Narration fully generated. Continuous MP3 ready.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Download MP3/ })).toBeEnabled();
});

test("refreshes the selected provider balance after a segment completes", async ({ page }) => {
  await page.getByLabel("OpenRouter API key").fill("test-key");
  await expect(page.getByLabel("Provider balance")).toContainText("10.00");
  await page.getByLabel("Book or chapter text").fill("Hello world");
  await page.getByRole("button", { name: "Start narration" }).click();
  await expect(page.getByLabel("Provider balance")).toContainText("9.00");
});

test("configures and serializes OpenRouter Gemini 3.1 continuity", async ({ page }) => {
  await page.route("**/api/openrouter/models", (route) => route.fulfill({ json: { models: [{ id: "google/gemini-3.1-flash-tts-preview", name: "Gemini 3.1 Flash TTS Preview", voices: [{ value: "Kore", label: "Kore" }] }] } }));
  await page.getByLabel("OpenRouter API key").fill("test-key");
  await expect(page.getByLabel("OpenRouter model")).toHaveValue("google/gemini-3.1-flash-tts-preview");
  await expect(page.getByLabel("Segment target")).toHaveValue("500");
  await page.getByText("Gemini continuity", { exact: true }).click();
  await expect(page.getByLabel("Enhanced continuity")).toBeChecked();
  await page.getByLabel("Narrator direction").fill("Warm and restrained.");
  await page.getByLabel("Book or chapter text").fill("inspect-gemini-options");
  await page.getByRole("button", { name: "Start narration" }).click();
  await expect(page.getByText("continuity=true; direction=Warm and restrained.")).toBeVisible();
});

test("makes partial stitched audio downloadable before completion and after stop", async ({ page }) => {
  await page.getByLabel("Provider", { exact: true }).selectOption("xai");
  await page.getByLabel("xAI API key").fill("test-key");
  await page.getByLabel("Book or chapter text").fill("partial");
  await page.getByRole("button", { name: "Start narration" }).click();
  const partialButton = page.getByRole("button", { name: /Download partial MP3/ });
  await expect(partialButton).toBeEnabled();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText(/Partial MP3 is ready/)).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await partialButton.click();
  expect((await downloadPromise).suggestedFilename()).toBe("xai-audiobook.mp3");
});

test("pauses generation at a segment boundary and resumes with the next segment", async ({ page }) => {
  await page.getByLabel("Provider", { exact: true }).selectOption("xai");
  await page.getByLabel("xAI API key").fill("test-key");
  await page.getByLabel("Book or chapter text").fill("pause-flow");
  await page.getByRole("button", { name: "Start narration" }).click();
  await expect(page.getByText("Generating segment 1...")).toBeVisible();
  await page.getByRole("button", { name: "Pause generation" }).click();
  await expect(page.getByText("Generation paused after segment 1. Playback remains available.")).toBeVisible();
  await expect(page.getByText("1 / 2 segments")).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume generation" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Start narration" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled();
  await page.getByRole("button", { name: "Resume generation" }).click();
  await expect(page.getByText("Narration fully generated. Continuous MP3 ready.")).toBeVisible();
  await expect(page.getByText("2 / 2 segments")).toBeVisible();
});

test("shows provider diagnostics and retries a rejected segment without restarting", async ({ page }) => {
  await page.getByLabel("OpenRouter API key").fill("test-key");
  await expect(page.getByLabel("OpenRouter model")).toBeEnabled();
  await page.getByLabel("Book or chapter text").fill("recovery-flow");
  await page.getByRole("button", { name: "Start narration" }).click();

  const failure = page.getByRole("alert");
  await expect(failure.getByText("Segment 2 was rejected")).toBeVisible();
  await expect(page.getByText("2 / 2 segments")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start narration" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Download partial MP3" })).toBeEnabled();

  await failure.getByText("Provider diagnostics").click();
  await expect(failure.getByText("content_policy_violation")).toBeVisible();
  await expect(failure.getByText("PROHIBITED_CONTENT")).toBeVisible();
  await page.getByRole("button", { name: "Retry segment" }).click();

  await expect(page.getByText("Narration fully generated. Continuous MP3 ready.")).toBeVisible();
  await expect(page.getByText("2 / 2 segments")).toBeVisible();
});
