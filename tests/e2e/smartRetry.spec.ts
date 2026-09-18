import { expect, test, type WebSocketRoute } from "@playwright/test";

test("Auto smart retry persists and starts recovery without a manual command", async ({ page, context }) => {
  let stream: WebSocketRoute | undefined;
  const commands: string[] = [];
  await page.route("**/api/google-oauth/status", (route) => route.fulfill({ json: { configured: false, connected: false } }));
  await page.route("**/api/openrouter/models", (route) => route.fulfill({ json: { models: [{ id: "google/gemini-3.1-flash-tts-preview", name: "Gemini", voices: [{ value: "Kore", label: "Kore" }] }] } }));
  await page.route("**/api/provider/balance", (route) => route.fulfill({ json: { available: false } }));
  await context.routeWebSocket(/\/stream$/, (socket) => {
    stream = socket;
    socket.onMessage((message) => {
      const command = JSON.parse(String(message));
      commands.push(command.type);
      if (command.type !== "start") return;
      expect(command.options.autoSmartRetry).toBe(true);
      socket.send(JSON.stringify({ type: "meta", audioEncoding: "pcm_s16le", sampleRate: 24000, channels: 1, totalSegments: 1 }));
      socket.send(JSON.stringify({ type: "segment", index: 1, totalSegments: 1 }));
      socket.send(JSON.stringify({ type: "smartRetryProgress", index: 1, attempts: 7, attemptLimit: 64, automatic: true, totalAttempts: 71, resolvedPieces: 30, skippedPieces: 1 }));
    });
  });
  await page.goto("/");
  await page.getByLabel("OpenRouter API key").fill("test-key");
  await page.getByLabel("OpenRouter model").selectOption("google/gemini-3.1-flash-tts-preview");
  const setting = page.getByRole("checkbox", { name: "Auto smart retry" });
  await expect(setting).not.toBeChecked();
  await setting.check();
  await page.reload();
  await page.getByLabel("OpenRouter API key").fill("test-key");
  await expect(setting).toBeChecked();
  await page.getByLabel("Book or chapter text").fill("A passage with rejected text.");
  await page.getByRole("button", { name: "Start narration" }).click();
  await expect(setting).toBeDisabled();
  await expect(page.getByText(/Auto smart retry: segment 1 · attempt 71/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Smart retry", exact: true })).toBeHidden();
  stream!.send(Buffer.alloc(4800));
  stream!.send(JSON.stringify({ type: "segmentDone", index: 1, totalSegments: 1, omissions: [{ index: 1, text: "rejected" }] }));
  stream!.send(JSON.stringify({ type: "complete" }));
  await expect(page.getByText("Narration completed with 1 omitted text piece. WAV ready.")).toBeVisible();
  await expect(setting).toBeEnabled();
  expect(commands).toEqual(["start"]);
});

test("Smart retry shows progress, resumes a checkpoint, and keeps omissions visible for downloads", async ({ page, context }, testInfo) => {
  let stream: WebSocketRoute | undefined;
  let smartRetries = 0;
  await page.route("**/api/google-oauth/status", (route) => route.fulfill({ json: { configured: false, connected: false } }));
  await page.route("**/api/openrouter/models", (route) => route.fulfill({ json: { models: [{ id: "google/gemini-3.1-flash-tts-preview", name: "Gemini 3.1 Flash TTS", voices: [{ value: "Kore", label: "Kore" }] }] } }));
  await page.route("**/api/provider/balance", (route) => route.fulfill({ json: { available: false } }));
  await context.routeWebSocket(/\/stream$/, (socket) => {
    stream = socket;
    socket.onMessage((message) => {
      const command = JSON.parse(String(message));
      if (command.type === "start") {
        socket.send(JSON.stringify({ type: "meta", audioEncoding: "pcm_s16le", sampleRate: 24000, channels: 1, totalSegments: 2 }));
        socket.send(JSON.stringify({ type: "segment", index: 1, totalSegments: 2 }));
        socket.send(JSON.stringify({ type: "segmentFailed", index: 1, totalSegments: 2, message: "Provider returned 400", smartRetryAvailable: true }));
      } else if (command.type === "smartRetrySegment") {
        smartRetries += 1;
        socket.send(JSON.stringify({ type: "segment", index: 1, totalSegments: 2 }));
        socket.send(JSON.stringify({ type: "smartRetryProgress", index: 1, attempts: 7, attemptLimit: 64, resolvedPieces: 3, skippedPieces: 1 }));
      }
    });
  });
  await page.goto("/");
  await page.getByLabel("OpenRouter API key").fill("test-key");
  await page.getByLabel("OpenRouter model").selectOption("google/gemini-3.1-flash-tts-preview");
  await page.getByLabel("Book or chapter text").fill("A passage with one rejected word.");
  await page.getByRole("button", { name: "Start narration" }).click();
  const smartRetry = page.getByRole("button", { name: "Smart retry", exact: true });
  await expect(smartRetry).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry segment", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip segment", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByRole("alert").screenshot({ path: testInfo.outputPath("smart-retry-dialog.png") });
  await smartRetry.click();
  await expect(page.getByText(/Smart retry: segment 1 · attempt 7\/64 · 3 pieces recovered/)).toBeVisible();
  await expect(smartRetry).toBeHidden();
  const send = (event: object) => stream!.send(JSON.stringify(event));
  send({ type: "segmentFailed", index: 1, totalSegments: 2, message: "Smart retry reached 64 piece attempts. Click Smart retry to continue saved progress.", smartRetryAvailable: true, smartRetryResumable: true });
  await expect(page.getByText(/Smart retry continues saved progress/)).toBeVisible();
  await smartRetry.click();
  await expect.poll(() => smartRetries).toBe(2);
  stream!.send(Buffer.alloc(4800));
  send({ type: "segmentDone", index: 1, totalSegments: 2, omissions: [{ index: 1, text: "rejected " }] });
  send({ type: "segment", index: 2, totalSegments: 2 });
  await expect(page.getByRole("button", { name: /Download partial WAV/ })).toBeEnabled();
  await page.getByText("1 text piece omitted by Smart retry", { exact: true }).click();
  await expect(page.locator(".omission-history li")).toHaveText("Segment 1: rejected");
  send({ type: "segmentDone", index: 2, totalSegments: 2 });
  send({ type: "complete" });
  await expect(page.getByText("Narration completed with 1 omitted text piece. WAV ready.")).toBeVisible();
  await expect(page.locator(".omission-history li")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download WAV/ }).click();
  expect((await download).suggestedFilename()).toBe("openrouter-audiobook.wav");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
