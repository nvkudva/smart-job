import { afterAll, beforeAll, expect, test } from "bun:test";
import { hasSuperJob } from "../../src/features.ts";
import { emptyProfile } from "../../src/storage.ts";
import * as harness from "./harness.ts";

let h: harness.Harness;
beforeAll(async () => {
  h = await harness.launch();
});
afterAll(async () => {
  await h?.close();
});

test.skipIf(!hasSuperJob)("Super Job button opens the search page with the saved roles as chips", async () => {
  await h.seed({
    setupComplete: true,
    profile: { ...emptyProfile, city: "Bengaluru", country: "India" },
    jobSearches: [{ role: "Staff Engineer", location: "Bengaluru", url: "" }],
  });
  const panel = await h.openPanel();
  const opened = h.context.waitForEvent("page");
  await panel.getByRole("button", { name: "Super Job" }).click();
  const page = await opened;

  expect(page.url()).toEndWith("/superjob.html");
  await page.getByLabel("Role").waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("button", { name: /Jobs in Bengaluru/ }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("button", { name: "Staff Engineer" }).waitFor({ state: "visible", timeout: 15000 });
}, 60000);
