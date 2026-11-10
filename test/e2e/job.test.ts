import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Page } from "playwright";
import type { JobPosting } from "../../src/types.ts";
import * as harness from "./harness.ts";

let h: harness.Harness;
let panel: Page;
beforeAll(async () => {
  h = await harness.launch();
  panel = await h.openPanel();
});
afterAll(async () => {
  await h?.close();
});

async function extractFrom(fixture: string): Promise<JobPosting | null | undefined> {
  const page = await h.context.newPage();
  await page.goto(`${h.baseUrl}/${fixture}`);
  await page.waitForTimeout(500);
  const [top] = (await harness.sendToTab(panel, fixture, { type: "extractJob" })) as (JobPosting | null)[];
  await page.close();
  return top;
}

const expectations: [string, Partial<JobPosting>][] = [
  ["linkedin-job.html?currentJobId=1001", { source: "linkedin", id: "linkedin:1001", title: "Senior Frontend Engineer", company: "Acme Robotics" }],
  ["jsonld-job.html", { source: "jsonld", title: "Backend Engineer", company: "Initech", salaryText: "USD 120,000–150,000 / year" }],
  ["greenhouse-job.html", { source: "greenhouse", title: "Platform Engineer", company: "Hooli" }],
  ["lever-job.html", { source: "lever", title: "Product Designer", location: "Remote - EU" }],
  ["workday-job.html", { source: "workday", title: "Software Engineer II", company: "Soylent" }],
  ["indeed-job.html", { source: "indeed", title: "QA Analyst", company: "Wonka Industries" }],
  ["generic-job.html", { source: "generic", title: "Staff Accountant" }],
];

for (const [fixture, expected] of expectations) {
  test(`extractJob on ${fixture}`, async () => {
    expect(await extractFrom(fixture)).toMatchObject(expected);
  }, 30000);
}

test("extractJob returns null on a non-job page", async () => {
  expect(await extractFrom("not-a-job.html")).toBeNull();
}, 30000);

test("LinkedIn in-page job swap sends jobChanged", async () => {
  await panel.evaluate(() => {
    (window as any).__jobChanged = [];
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "jobChanged") (window as any).__jobChanged.push(message.url);
    });
  });
  const page = await h.context.newPage();
  await page.goto(`${h.baseUrl}/linkedin-job.html?currentJobId=1001`);
  await page.waitForTimeout(1500);
  await panel.evaluate(() => ((window as any).__jobChanged = []));
  await page.click("#swap");
  await panel.waitForFunction(() => (window as any).__jobChanged.some((url: string) => url.includes("currentJobId=1002")), null, { timeout: 5000 });
  const [top] = (await harness.sendToTab(panel, "linkedin-job.html", { type: "extractJob" })) as JobPosting[];
  expect(top).toMatchObject({ id: "linkedin:1002", title: "Data Engineer", company: "Globex Analytics", location: "London, United Kingdom" });
}, 30000);
