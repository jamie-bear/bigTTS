import { readFileSync } from "node:fs";
import { expect, test, type WebSocketRoute } from "@playwright/test";

const segmentAudio = readFileSync(new URL("../fixtures/segment-tone.mp3", import.meta.url));

test("MiniMax plays completed MP3 segments before generation finishes", async ({ page, context }) => {
  test.setTimeout(90_000);
  let stream: WebSocketRoute | undefined;
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/google-oauth/status", (route) => route.fulfill({ json: { configured: false, connected: false } }));
  await page.route("**/api/openrouter/models", (route) => route.fulfill({ json: { models: [] } }));
  await page.route("**/api/provider/balance", (route) => route.fulfill({ json: { available: false } }));
  await page.route("**/api/minimax/voices", (route) => route.fulfill({ json: { voices: [{ id: "test-voice", name: "Test narrator" }] } }));
  await context.routeWebSocket(/\/stream$/, (socket) => {
    socket.onMessage((message) => {
      const command = JSON.parse(String(message));
      if (command.type !== "start") return;
      expect(command.options.provider).toBe("minimax");
      stream = socket;
      socket.send(JSON.stringify({ type: "meta", audioEncoding: "mpeg", sampleRate: 24000, channels: 1, totalSegments: 3 }));
      socket.send(JSON.stringify({ type: "segment", index: 1, totalSegments: 3 }));
    });
  });
  await page.goto("/");
  await page.getByLabel("Provider", { exact: true }).selectOption("minimax");
  await page.getByLabel("MiniMax API key").fill("test-key");
  await page.getByLabel("Voice ID Optional", { exact: true }).fill("test-voice");
  await page.getByLabel("Book or chapter text").fill("Three segments of narration.");
  await page.getByRole("button", { name: "Start narration" }).click();
  await expect.poll(() => Boolean(stream)).toBe(true);
  const send = (value: object) => stream!.send(JSON.stringify(value));
  const finishSegment = (index: number) => {
    stream!.send(segmentAudio);
    send({ type: "segmentDone", index, totalSegments: 3 });
  };
  const audio = page.getByLabel("Generated narration playback");

  // The first segment is deliberately delivered after the Start click has returned.
  finishSegment(1);
  send({ type: "segment", index: 2, totalSegments: 3 });
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime), { timeout: 15_000 }).toBeGreaterThan(0.15);
  await expect(page.getByRole("button", { name: "Pause playback" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Download partial MP3/ })).toBeEnabled();
  await page.getByLabel("Playback speed").selectOption("1.5");

  // Queue more audio during playback and verify continuation past segment one's end.
  finishSegment(2);
  send({ type: "segment", index: 3, totalSegments: 3 });
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime), { timeout: 15000 }).toBeGreaterThan(2.3);
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.playbackRate)).toBe(1.5);
  await page.getByRole("button", { name: "Pause playback" }).click();
  finishSegment(3);
  await expect(page.getByText("Buffered segment 3.", { exact: true })).toBeVisible();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState)).toBeGreaterThanOrEqual(1);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await page.getByRole("button", { name: "Play narration" }).click();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);

  send({ type: "complete" });
  await expect(page.getByText("Narration fully generated. Continuous MP3 ready.")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download MP3/ }).click();
  expect((await download).suggestedFilename()).toBe("minimax-audiobook.mp3");
  expect(pageErrors).toEqual([]);
});
