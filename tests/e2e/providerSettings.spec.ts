import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/google-oauth/status", (route) => route.fulfill({ json: { configured: false, connected: false } }));
  await page.route("**/api/minimax/voices", (route) => route.fulfill({ json: { voices: [{ id: "narrator", name: "Narrator", available: true }] } }));
  await page.route("**/api/resemble/voices", (route) => route.fulfill({ json: { voices: [{ id: "ultra", name: "Ultra", available: true }, { id: "legacy", name: "Legacy", available: false, unavailableReason: "Upgrade to Ultra" }], warning: "Voice discovery is incomplete." } }));
});

test("MiniMax settings persist and model changes gate unsupported controls", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Provider", { exact: true }).selectOption("minimax");
  await page.getByText("Advanced MiniMax settings", { exact: true }).click();
  await page.getByLabel("MiniMax speech model").selectOption("speech-2.6-hd");
  await page.getByLabel("Emotion", { exact: true }).selectOption("whisper");
  await page.getByLabel("Language", { exact: true }).selectOption("Tamil");
  await page.getByLabel("Normalize numbers and abbreviations").check();
  await page.getByLabel("Pronunciation dictionary").fill("Dr./Doctor");
  await page.reload();
  await page.getByText("Advanced MiniMax settings", { exact: true }).click();
  await expect(page.getByLabel("Pronunciation dictionary")).toHaveValue("Dr./Doctor");
  await expect(page.getByLabel("Emotion", { exact: true })).toHaveValue("whisper");
  await expect(page.getByLabel("Normalize numbers and abbreviations")).toBeChecked();
  await page.getByLabel("MiniMax speech model").selectOption("speech-02-hd");
  await expect(page.getByLabel("Emotion", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Language", { exact: true }).locator('option[value="Tamil"]')).toBeDisabled();
  await page.getByLabel("Book or chapter text").fill("a".repeat(10000));
  await expect(page.getByLabel("Text statistics")).toContainText("$1.000 PAYG estimate");
  await page.getByLabel("MiniMax speech model").selectOption("speech-01-hd");
  await expect(page.getByLabel("Text statistics")).toContainText("Estimate unavailable");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("minimax-settings.png"), fullPage: true });
});

test("Resemble upgrade guidance and delivery settings remain usable on small screens", async ({ page }, testInfo) => {
  let received: { options: { voice: string; resemble: { hd: boolean; prompt: string; delivery: string; seed: string } } } | undefined;
  await page.routeWebSocket(/\/stream$/, (socket) => {
    socket.onMessage((message) => { received = JSON.parse(String(message)); socket.send(JSON.stringify({ type: "status", message: "Options received" })); });
  });
  await page.goto("/");
  await page.getByLabel("Provider", { exact: true }).selectOption("resemble");
  await page.getByLabel("Resemble.ai API key").fill("test-key");
  await expect(page.getByRole("link", { name: "Open Resemble Voices" })).toBeVisible();
  await expect(page.getByText("Voice discovery is incomplete.")).toBeVisible();
  await expect(page.getByLabel("Segment size").locator('option[value="4500"]')).toBeDisabled();
  await page.getByText("Resemble delivery settings", { exact: true }).click();
  await page.getByLabel("HD synthesis").check();
  await page.getByLabel("Narrator direction", { exact: false }).fill('Warm & "calm"');
  await page.getByLabel("Delivery speed").selectOption("slow");
  await page.getByLabel("Seed", { exact: false }).fill("0");
  await page.getByLabel("Voice ID", { exact: false }).fill("manual-unknown");
  await page.getByLabel("Book or chapter text").fill("Read this.");
  await page.getByRole("button", { name: "Start narration" }).click();
  await expect.poll(() => received?.options.voice).toBe("manual-unknown");
  expect(received?.options.resemble).toMatchObject({ hd: true, prompt: 'Warm & "calm"', delivery: "slow", seed: "0" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("resemble-settings.png"), fullPage: true });
});

for (const provider of ["resemble", "minimax"] as const) {
  test(`${provider} plays and downloads two completed segments`, async ({ page }) => {
    const pcm = provider === "resemble";
    const sampleRate = pcm ? 22050 : 44100;
    const frame = Buffer.alloc(417);
    frame.set([0xff, 0xfb, 0x90, 0xc0]);
    const segment = pcm ? Buffer.alloc(sampleRate * 2) : Buffer.concat(Array.from({ length: 40 }, () => frame));
    await page.routeWebSocket(/\/stream$/, (socket) => socket.onMessage((message) => {
      if (JSON.parse(String(message)).type !== "start") return;
      socket.send(JSON.stringify({ type: "meta", audioEncoding: pcm ? "pcm_s16le" : "mpeg", sampleRate, channels: 1, totalSegments: 2 }));
      for (const index of [1, 2]) {
        socket.send(JSON.stringify({ type: "segment", index, totalSegments: 2 }));
        socket.send(segment);
        socket.send(JSON.stringify({ type: "segmentDone", index, totalSegments: 2 }));
      }
      socket.send(JSON.stringify({ type: "complete" }));
    }));
    await page.goto("/");
    await page.getByLabel("Provider", { exact: true }).selectOption(provider);
    await page.locator("#apiKey").fill("test-key");
    await page.getByLabel("Voice ID", { exact: false }).fill("manual-voice");
    await page.getByLabel("Book or chapter text").fill("Two segments.");
    await page.getByRole("button", { name: "Start narration" }).click();
    await expect(page.getByText("2 / 2 segments")).toBeVisible();
    const audio = page.locator("audio");
    await expect.poll(() => audio.evaluate((element) => (element as HTMLAudioElement).duration)).toBeGreaterThan(1.9);
    await audio.evaluate((element) => (element as HTMLAudioElement).play());
    await expect.poll(() => audio.evaluate((element) => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: pcm ? /Download WAV/ : /Download MP3/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`${provider}-audiobook.${pcm ? "wav" : "mp3"}`);
    const contents = await readFile((await download.path())!);
    expect(contents.length).toBe(segment.length * 2 + (pcm ? 44 : 0));
    if (pcm) expect(contents.readUInt32LE(24)).toBe(22050);
    expect(contents.subarray(pcm ? 44 : 0)).toEqual(Buffer.concat([segment, segment]));
  });
}

test("MiniMax clone creation reads WAV duration and forwards preprocessing without a preview", async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  await page.route("**/api/minimax/voices/create", (route) => {
    payload = route.request().postDataJSON();
    return route.fulfill({ json: { voice: { id: "new-voice", name: "New narrator", available: true } } });
  });
  await page.goto("/");
  await page.getByLabel("Provider", { exact: true }).selectOption("minimax");
  await page.getByLabel("MiniMax API key").fill("test-key");
  await expect(page.getByLabel("Voice", { exact: true })).toHaveValue("narrator");
  await page.getByText("Custom voice library", { exact: true }).click();
  await page.getByRole("button", { name: "Add new voice" }).click();
  await page.getByLabel("Voice name", { exact: true }).fill("New narrator");
  const audio = Buffer.alloc(44 + 24000 * 10 * 2);
  audio.write("RIFF"); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(24000, 24); audio.writeUInt32LE(48000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write("data", 36); audio.writeUInt32LE(audio.length - 44, 40);
  await page.getByLabel("Source audio", { exact: true }).setInputFiles({ name: "voice.wav", mimeType: "audio/wav", buffer: audio });
  await page.getByLabel("Reduce recording noise").uncheck();
  await page.getByRole("button", { name: "Create voice", exact: true }).click();
  await expect.poll(() => payload?.name).toBe("New narrator");
  expect(payload?.noiseReduction).toBe(false);
  expect(payload?.volumeNormalization).toBe(true);
  expect(payload).not.toHaveProperty("text");
  await expect(page.getByLabel("Voice", { exact: true })).toHaveValue("new-voice");
});
