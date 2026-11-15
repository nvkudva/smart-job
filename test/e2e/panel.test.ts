import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Locator, Page } from "playwright";
import { emptyProfile } from "../../src/storage.ts";
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
const visible = (locator: Locator, ms = timeout) => locator.waitFor({ state: "visible", timeout: ms });
const hidden = (locator: Locator, ms = timeout) => locator.waitFor({ state: "hidden", timeout: ms });
async function valueMatches(locator: Locator, pattern: RegExp, ms = timeout): Promise<void> {
  const deadline = Date.now() + ms;
  let value = "";
  while (Date.now() < deadline) {
    value = await locator.inputValue().catch(() => "");
    if (pattern.test(value)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`value ${JSON.stringify(value)} never matched ${pattern}`);
}

const provider = () => ({ kind: "openai", baseUrl: llm.baseUrl, apiKey: "", model: "fake" });
const stored = (panel: Page, key: string) => panel.evaluate(async (name) => (await chrome.storage.local.get(name))[name], key);
const resume = { text: "Ada Lovelace. TypeScript and Preact engineer.", fileName: "resume.txt", fileBase64: "", mimeType: "text/plain" };

test("first run shows the setup wizard; skipping lands on Settings", async () => {
  const panel = await h.openPanel();
  await visible(panel.getByText("Set up SmartJob"));
  await visible(panel.getByRole("button", { name: "Save and continue" }));
  await panel.getByRole("button", { name: "Skip" }).click();
  await visible(panel.getByText("Welcome to SmartJob"));
  expect(await panel.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe("true");
  await panel.getByRole("tab", { name: "Analysis" }).click();
  await visible(panel.getByText("Welcome to SmartJob"));
  await panel.close();
}, 30000);

test("settings, resume and profile extraction persist", async () => {
  const panel = await h.openPanel();
  await panel.getByRole("tab", { name: "Settings" }).click();
  await panel.getByLabel("Base URL").fill(llm.baseUrl);
  await panel.getByLabel("Model").fill("fake");
  await panel.getByRole("button", { name: "Save settings" }).click();
  await visible(panel.getByText("Saved").first());
  expect(((await stored(panel, "settings")) as { provider: { baseUrl: string } }).provider.baseUrl).toBe(llm.baseUrl);

  await panel.getByRole("button", { name: "Test connection" }).click();
  await visible(panel.getByText(/Connected in \d+ ms/));
  await visible(panel.locator(".dot.status-ok").first());

  await panel.getByRole("tab", { name: "Profile", exact: true }).click();
  await panel.getByLabel("Resume text").fill(resume.text);
  await panel.getByRole("button", { name: "Save resume" }).click();
  await hidden(panel.getByText("Welcome to SmartJob"));
  expect(((await stored(panel, "resume")) as { text: string }).text).toBe(resume.text);

  await panel.getByRole("button", { name: "Extract profile with AI" }).click();
  await visible(panel.getByText("Profile updated"));
  expect(((await stored(panel, "profile")) as { firstName: string }).firstName).toBe("Ada");
  await valueMatches(panel.getByLabel("First name"), new RegExp("Ada"));
  await panel.close();
}, 60000);

async function openPanelOnJob(fixture: string): Promise<Page> {
  const jobPage = await h.context.newPage();
  await jobPage.goto(`${h.baseUrl}/${fixture}`);
  await jobPage.waitForTimeout(500);
  const probe = await h.openPanel();
  const tabId = await probe.evaluate(async (part) => (await chrome.tabs.query({})).find((tab) => tab.url?.includes(part))?.id, fixture);
  await probe.goto(`chrome-extension://${h.extensionId}/sidepanel.html?tabId=${tabId}`);
  return probe;
}

test("job tab shows job, analysis, salary; shortlist reaches tracker; write tab generates", async () => {
  await h.seed({
    settings: { provider: provider(), autoFillOnPageChange: false, autoAnalyze: true, salarySearch: false },
    resume,
    profile: { ...emptyProfile, firstName: "Ada", lastName: "Lovelace", skills: ["TypeScript", "Preact"] },
    jobs: {},
    analyses: {},
  });
  const panel = await openPanelOnJob("panel-job.html");

  await visible(panel.locator(".job-title").first(), 15000);
  expect(await panel.locator(".job-title").first().textContent()).toBe("Panel Test Engineer");
  await visible(panel.locator(".ring"), 20000);
  await visible(panel.getByText("Strong match - apply"));
  await visible(panel.getByText(/\$130,000 – \$160,000\/yr/));

  await panel.getByRole("button", { name: "★ Shortlist" }).click();
  await visible(panel.getByRole("button", { name: "★ Shortlisted" }));
  await panel.getByRole("tab", { name: "Track" }).click();
  await visible(panel.getByRole("tabpanel", { name: "Track" }).getByText("Panel Test Engineer"));
  const tracked = Object.values((await stored(panel, "jobs")) as Record<string, { status: string; analysis: { matchScore: number } }>);
  expect(tracked).toHaveLength(1);
  expect(tracked[0]!.analysis.matchScore).toBe(83);

  await panel.getByRole("tab", { name: "Analysis" }).click();
  await panel.getByRole("button", { name: "Apply", exact: true }).click();
  const write = panel.getByRole("tabpanel", { name: "Apply" });
  await visible(write.getByText("SmartJob never submits"));
  await write.getByRole("button", { name: "Generate" }).first().click();
  await valueMatches(write.getByLabel("Cover letter text"), /Fake cover letter/);
  await write.getByLabel("Application question").fill("Why do you want this job?");
  await write.getByRole("button", { name: "Answer", exact: true }).click();
  await valueMatches(write.getByLabel("Answer", { exact: true }), new RegExp("Fake answer to your question."));
  await write.getByRole("button", { name: "Save to answer bank" }).click();
  await visible(write.getByRole("button", { name: "Saved to answer bank" }));
  expect(Object.keys((await stored(panel, "answers")) as object)).toHaveLength(1);

  await panel.getByRole("tab", { name: "Track" }).click();
  const tracker = panel.getByRole("tabpanel", { name: "Track" });
  await visible(tracker.getByText(/Job posting on/));
  await visible(tracker.getByText("Cover letter", { exact: true }));
  await panel.close();
}, 90000);

test("apply tab runs a fill and never crashes the panel", async () => {
  const panel = await openPanelOnJob("panel-job.html");
  const apply = panel.getByRole("tabpanel", { name: "Apply" });
  await panel.getByRole("tab", { name: "Apply" }).click();
  await visible(apply.getByText("SmartJob never submits"));
  await apply.getByRole("button", { name: "Fill this page" }).click();
  // either a report (session implemented) or an inline error; both leave the button usable again
  await visible(apply.locator(".report-row, .error, :text('No fillable fields')").first(), 20000);
  expect(await apply.getByRole("button", { name: "Fill this page" }).isEnabled()).toBe(true);
  await panel.close();
}, 60000);

test("start applying opens the Apply link, fills the form and does not submit", async () => {
  await h.seed({
    settings: { provider: provider(), autoFillOnPageChange: false, autoAnalyze: false, salarySearch: false, account: { email: "", password: "" } },
    resume,
    profile: { ...emptyProfile, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
    jobs: {},
    analyses: {},
  });
  const panel = await openPanelOnJob("apply-job.html");
  await panel.getByRole("tab", { name: "Apply" }).click();
  const apply = panel.getByRole("tabpanel", { name: "Apply" });
  await apply.getByRole("button", { name: "Start applying" }).click();
  await visible(apply.getByText("Filled. Review it, then submit yourself."), 40000);
  const portal = h.context.pages().find((candidate) => candidate.url().includes("lever-apply.html"));
  expect(portal).toBeDefined();
  expect(await portal!.locator("#name").inputValue()).toBe("Ada Lovelace");
  expect(await portal!.locator("#email").inputValue()).toBe("ada@example.com");
  await panel.close();
}, 90000);

test("setup wizard: provider, profile, review, job searches, then tabs", async () => {
  await h.seed({ setupComplete: false, resume: null, profile: emptyProfile, jobSearches: [] });
  const panel = await h.openPanel();
  await panel.getByLabel("Base URL").fill(llm.baseUrl);
  await panel.getByLabel("Model").fill("fake");
  await panel.getByRole("button", { name: "Save and continue" }).click();

  await panel.getByLabel("Resume text").fill(resume.text);
  await panel.getByRole("button", { name: "Build my profile" }).click();
  await visible(panel.getByText("3. Review your details"));
  await valueMatches(panel.getByLabel("First name"), /Ada/);
  await panel.getByLabel("Notice period").fill("30 days");
  await panel.getByRole("button", { name: "Save and continue" }).click();

  await visible(panel.getByText("4. Job searches"));
  await visible(panel.getByRole("button", { name: "Engineer", exact: true }));
  await panel.getByRole("button", { name: "Finish" }).click();
  await panel.getByRole("tab", { name: "Analysis" }).click();
  await visible(panel.getByRole("link", { name: "Engineer" }));
  const searches = (await stored(panel, "jobSearches")) as { url: string }[];
  expect(searches[0]!.url).toBe("https://www.linkedin.com/jobs/search-results/?keywords=Engineer");
  expect(((await stored(panel, "profile")) as { noticePeriod: string }).noticePeriod).toBe("30 days");
  expect(await stored(panel, "setupComplete")).toBe(true);
  await panel.close();
}, 60000);
