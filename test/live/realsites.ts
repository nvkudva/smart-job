// Manual check against real public job sites: `bun run build && bun test/live/realsites.ts`.
// Opens a real application form, drives the actual side panel ("Fill this page"), prints the report, saves screenshots. Never submits.
import type { Page } from "playwright";
import { defaultSettings, emptyProfile } from "../../src/storage.ts";
import type { FieldDescriptor, Profile } from "../../src/types.ts";
import * as harness from "../e2e/harness.ts";

const profile: Profile = {
  ...emptyProfile,
  firstName: "Priya",
  lastName: "Raman",
  email: "priya.raman@example.com",
  phone: "4155550100",
  phoneCountryCode: "+1",
  city: "San Francisco",
  state: "California",
  postalCode: "94105",
  country: "United States",
  linkedin: "https://www.linkedin.com/in/priya-raman",
  github: "https://github.com/priyaraman",
  website: "https://priya.dev",
  currentTitle: "Senior Software Engineer",
  currentCompany: "Acme Corp",
  yearsExperience: 7,
  skills: ["TypeScript", "React", "Node.js", "Python", "AWS", "PostgreSQL"],
  experience: [
    { title: "Senior Software Engineer", company: "Acme Corp", location: "San Francisco", start: "2020-03", end: "", current: true, description: "Led payments platform." },
  ],
  education: [{ school: "UC Berkeley", degree: "Bachelor of Science", field: "Computer Science", start: "2013-08", end: "2017-05", gpa: "" }],
  workAuthorized: "yes",
  requiresSponsorship: "no",
  willingToRelocate: "yes",
};

const outDir = process.env.OUT_DIR ?? "/tmp";
const llmBaseUrl = process.env.LLM_BASE_URL ?? "http://localhost:1234/v1";
const llmModel = process.env.LLM_MODEL ?? "qwen3.5-4b-mlx";

async function findFormUrl(page: Page, site: string): Promise<string> {
  if (process.env.APPLY_URL) return process.env.APPLY_URL; // any application form, e.g. SmartRecruiters
  if (site === "greenhouse") {
    await page.goto(`https://job-boards.greenhouse.io/${process.env.GH_BOARD ?? "anthropic"}`, { waitUntil: "networkidle" });
    const href = await page.locator('a[href*="/jobs/"]').nth(Number(process.env.JOB_INDEX ?? 0)).getAttribute("href");
    return new URL(href!, page.url()).href;
  }
  if (site === "ashby") {
    const board = process.env.ASHBY_BOARD ?? "ramp";
    await page.goto(`https://jobs.ashbyhq.com/${board}`, { waitUntil: "networkidle" });
    const href = await page.locator(`a[href*="/${board}/"]`).first().getAttribute("href");
    return `${new URL(href!, page.url()).href.split("?")[0]}/application`;
  }
  await page.goto(`https://jobs.lever.co/${process.env.LEVER_BOARD ?? "palantir"}`, { waitUntil: "domcontentloaded" });
  const href = await page.locator("a.posting-title").nth(Number(process.env.JOB_INDEX ?? 0)).getAttribute("href");
  return `${href}/apply`;
}

/** Saves the page HTML, and with DUMP=<regex> prints the container markup of every field whose label matches. */
async function dumpHtml(page: Page, site: string) {
  await Bun.write(`${outDir}/real-${site}.html`, await page.content());
  const pattern = process.env.DUMP;
  if (!pattern) return;
  const snippets = await page.evaluate((source) => {
    const matcher = new RegExp(source, "i");
    return Array.from(document.querySelectorAll<HTMLElement>("[data-sj-id]"))
      .filter((element) => matcher.test(element.closest("li, .field, [class*=field], fieldset, div")?.textContent ?? ""))
      .map((element) => (element.parentElement?.parentElement?.outerHTML ?? element.outerHTML).slice(0, 2500));
  }, pattern);
  console.log(snippets.join("\n-----\n"));
}

async function runSite(h: harness.Harness, site: string) {
  const page = await h.context.newPage();
  const url = await findFormUrl(page, site);
  await page.goto(url, { waitUntil: "networkidle" }).catch(() => undefined);
  const panel = await h.openPanel();
  const tabId = await panel.evaluate(async (target) => (await chrome.tabs.query({})).find((tab) => tab.url === target)?.id, page.url());
  await panel.goto(`chrome-extension://${h.extensionId}/sidepanel.html?tabId=${tabId}`);
  await panel.getByRole("tab", { name: "Apply" }).click();
  await panel.getByRole("button", { name: "Fill this page" }).click();
  await panel.getByRole("button", { name: "Fill this page" }).waitFor({ timeout: 300_000 });
  await panel.waitForTimeout(500);
  console.log(`\n=== ${site}: ${url}`);
  const scans = (await harness.sendToTab(panel, page.url(), { type: "scanFields" })) as (FieldDescriptor[] | undefined)[];
  for (const field of scans.flat()) {
    if (!field) continue;
    const value = field.currentValue.slice(0, 40) || "—";
    console.log(`${field.required ? "*" : " "} ${field.kind.padEnd(9)} ${field.label.slice(0, 60).padEnd(60)} | ${field.section.slice(0, 20).padEnd(20)} | opts:${field.options.length} | ${value}`);
  }
  await dumpHtml(page, site);
  await page.screenshot({ path: `${outDir}/real-${site}-form.png`, fullPage: true });
  await panel.screenshot({ path: `${outDir}/real-${site}-panel.png`, fullPage: true });
}

const h = await harness.launch();
await h.seed({
  profile,
  resume: { text: "Priya Raman — Senior Software Engineer, 7 years TypeScript/React/Node, payments.", fileName: "resume.pdf", fileBase64: Buffer.from("%PDF-1.4 test").toString("base64"), mimeType: "application/pdf" },
  settings: { ...defaultSettings, autoAnalyze: false, provider: { kind: "openai", baseUrl: llmBaseUrl, apiKey: "", model: llmModel } },
});
for (const site of (process.env.SITES ?? "greenhouse,lever").split(",")) {
  await runSite(h, site).catch((error) => console.log(`${site} failed:`, error.message));
}
await h.close();
