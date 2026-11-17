import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Locator, Page } from "playwright";
import { emptyProfile } from "../../src/storage.ts";
import type { JobPosting } from "../../src/types.ts";
import * as fakeLlm from "./fakeLlm.ts";
import * as harness from "./harness.ts";

let h: harness.Harness;
let llm: fakeLlm.FakeLlm;
beforeAll(async () => {
  llm = fakeLlm.start();
  h = await harness.launch();
});
afterAll(async () => {
  llm?.stop();
  await h?.close();
});

const timeout = 15000;
const visible = (locator: Locator) => locator.waitFor({ state: "visible", timeout });

const posting = (id: string, title: string, company: string): JobPosting => ({
  id,
  url: `https://www.linkedin.com/jobs/view/${id.split(":")[1]}`,
  title,
  company,
  location: "Bengaluru",
  description: "Responsibilities: lead a team building browser extensions in TypeScript. Requirements: TypeScript, testing with Playwright, Preact.",
  salaryText: "",
  employmentType: "",
  source: "linkedin",
});

/** Writes the selection the way the Super Job page does, from the page itself (same storage the panel reads). */
function publish(page: Page, tabId: number, job: JobPosting | null, isLoading = false): Promise<void> {
  return page.evaluate(
    async ({ tabId, job, isLoading }) => {
      await chrome.storage.session.set({ [`superjobSelection:${tabId}`]: { job, isLoading } });
    },
    { tabId, job, isLoading },
  );
}

test("the panel follows the job selected on the Super Job page and analyses it", async () => {
  await h.seed({
    setupComplete: true,
    settings: { provider: { kind: "openai", baseUrl: llm.baseUrl, apiKey: "", model: "fake" }, autoFillOnPageChange: false, autoAnalyze: true, salarySearch: false },
    resume: { text: "Ada Lovelace. TypeScript and Preact engineer.", fileName: "resume.txt", fileBase64: "", mimeType: "text/plain" },
    profile: { ...emptyProfile, firstName: "Ada", lastName: "Lovelace", skills: ["TypeScript", "Preact"] },
    jobs: {},
    analyses: {},
  });
  const superJob = await h.context.newPage();
  await superJob.goto(`chrome-extension://${h.extensionId}/superjob.html`);
  const tabId = (await superJob.evaluate(() => chrome.tabs.getCurrent()))!.id!;

  const panel = await h.context.newPage();
  await panel.goto(`chrome-extension://${h.extensionId}/sidepanel.html?tabId=${tabId}`);
  await visible(panel.getByText("No job detected").first());

  await publish(superJob, tabId, posting("linkedin:111", "Staff Platform Engineer", "Globex"));
  await visible(panel.locator(".job-title").first());
  expect(await panel.locator(".job-title").first().textContent()).toBe("Staff Platform Engineer");
  await visible(panel.getByText("Globex").first());
  await visible(panel.getByText("Strong match - apply"));

  await publish(superJob, tabId, posting("linkedin:222", "Engineering Manager", "Initech"));
  await panel.getByText("Initech").first().waitFor({ state: "visible", timeout });
  expect(await panel.locator(".job-title").first().textContent()).toBe("Engineering Manager");
  const analysedIds = async () => Object.keys(await panel.evaluate(async () => (await chrome.storage.local.get("analyses")).analyses ?? {}));
  for (let wait = 0; wait < 100 && !(await analysedIds()).includes("linkedin:222"); wait++) await panel.waitForTimeout(100);
  expect(await analysedIds()).toEqual(expect.arrayContaining(["linkedin:111", "linkedin:222"]));
}, 90000);
