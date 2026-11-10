import { afterAll, beforeAll, expect, test } from "bun:test";
import * as harness from "./harness.ts";

let h: harness.Harness;
beforeAll(async () => {
  h = await harness.launch();
});
afterAll(async () => {
  await h?.close();
});

test("extension loads and content script answers in all frames", async () => {
  const page = await h.context.newPage();
  await page.goto(`${h.baseUrl}/index.html`);
  await page.waitForTimeout(500);
  const panel = await h.openPanel();
  await expect(panel.locator("#root")).toBeDefined();
  const responses = (await harness.sendToTab(panel, "/index.html", { type: "ping" })) as { ok: boolean; isTop: boolean }[];
  expect(responses.filter((response) => response?.ok).length).toBe(2);
}, 30000);
