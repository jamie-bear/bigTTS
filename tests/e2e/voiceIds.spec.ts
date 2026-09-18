import { expect, test } from "@playwright/test";

test("voice ID overrides remain usable and persist on desktop and mobile", async ({ page }, testInfo) => {
  await page.route("**/api/google-oauth/status", (route) => route.fulfill({ json: { configured: false, connected: false } }));
  await page.route("**/api/resemble/voices", (route) => route.fulfill({ json: { voices: [{ id: "library-resemble", name: "Resemble narrator" }] } }));
  await page.route("**/api/minimax/voices", (route) => route.fulfill({ json: { voices: [{ id: "library-minimax", name: "MiniMax narrator" }] } }));
  const submitted: string[] = [];
  await page.routeWebSocket(/\/stream$/, (socket) => socket.onMessage((message) => {
    const command = JSON.parse(String(message));
    if (command.type === "start") {
      submitted.push(command.options.voice);
      socket.send(JSON.stringify({ type: "complete" }));
    }
  }));
  await page.goto("/");
  for (const provider of ["resemble", "minimax"]) {
    await page.getByLabel("Provider", { exact: true }).selectOption(provider);
    await page.locator("#apiKey").fill("test-key");
    await expect(page.getByLabel("Voice", { exact: true })).toHaveValue(`library-${provider}`);
    const input = page.getByLabel("Voice ID Optional");
    await input.fill(provider === "resemble" ? " 819fcc57 " : " MiniMax-AbC ");
    await expect(input).toHaveAccessibleDescription("Overrides the selected voice. Clear this field to use the dropdown.");
    await expect(page.getByLabel("Voice", { exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await input.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${provider}-voice-id.png`), fullPage: true });
    await page.getByLabel("Book or chapter text").fill("Read this sentence.");
    await page.getByRole("button", { name: "Start narration" }).click();
    await expect.poll(() => submitted.at(-1)).toBe(provider === "resemble" ? "819fcc57" : "MiniMax-AbC");
    await expect(page.getByRole("button", { name: "Start narration" })).toBeEnabled();
  }
  await page.reload();
  await expect(page.getByLabel("Voice ID Optional")).toHaveValue(" MiniMax-AbC ");
  await page.getByLabel("Provider", { exact: true }).selectOption("resemble");
  await expect(page.getByLabel("Voice ID Optional")).toHaveValue(" 819fcc57 ");
  await page.getByLabel("Voice ID Optional").fill("");
  await page.reload();
  await expect(page.getByLabel("Voice ID Optional")).toHaveValue("");
});
