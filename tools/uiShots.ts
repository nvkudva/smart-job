// Captures every panel tab and Super Job state as PNGs for UI review. Usage: bun run build.ts && bun tools/uiShots.ts <outDir> [dark]
import type { Page } from "playwright";
import { emptyProfile } from "../src/storage.ts";
import * as fakeLlm from "../test/e2e/fakeLlm.ts";
import * as harness from "../test/e2e/harness.ts";

const outDir = process.argv[2] ?? "shots";
const scheme = process.argv[3] === "dark" ? "dark" : "light";
const llm = fakeLlm.start();
const h = await harness.launch({ deviceScaleFactor: 2 });
const provider = { kind: "openai", baseUrl: llm.baseUrl, apiKey: "", model: "fake" };
const resume = { text: "Ada Lovelace. TypeScript and Preact engineer.", fileName: "resume.txt", fileBase64: "", mimeType: "text/plain" };
const profile = { ...emptyProfile, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "+91 98765 43210", city: "Bengaluru", country: "India", skills: ["TypeScript", "Preact", "Playwright", "Python", "AWS", "React", "Leadership", "Mentoring"], yearsExperience: 12 };

async function shot(page: Page, name: string) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outDir}/${scheme}-${name}.png`, fullPage: true });
  console.log("shot", name);
}
async function prep(page: Page, width = 400, height = 860) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme: scheme });
}

// 1. setup wizard
const wizard = await h.openPanel();
await prep(wizard);
await shot(wizard, "01-wizard-step1");
await wizard.getByLabel("Base URL").fill(llm.baseUrl);
await wizard.getByLabel("Model", { exact: true }).fill("fake");
await wizard.getByLabel("I understand how SmartJob handles my data and agree to continue").check();
await wizard.getByRole("button", { name: "Save and continue" }).click();
await shot(wizard, "02-wizard-step2");
await wizard.getByLabel("Resume text").fill(resume.text);
await wizard.getByRole("button", { name: "Build my profile" }).click();
await wizard.getByText("3. Review your details").waitFor({ timeout: 15000 });
await shot(wizard, "03-wizard-step3");
await wizard.getByRole("button", { name: "Save and continue" }).click();
await wizard.getByRole("heading", { name: "4. Job searches" }).waitFor({ timeout: 15000 });
await shot(wizard, "04-wizard-step4");
await wizard.close();

// 2. panel with a job
await h.seed({ setupComplete: true, settings: { provider, autoFillOnPageChange: false, autoAnalyze: true, salarySearch: false }, resume, profile, jobs: {}, analyses: {}, recentSearches: [{ role: "Engineering Manager", location: "Bengaluru" }, { role: "Product Manager", location: "Pune" }, { role: "Data Scientist", location: "" }], jobSearches: [{ role: "Staff Engineer", location: "Bengaluru", url: "https://www.linkedin.com/jobs/search-results/?keywords=Staff%20Engineer" }] });
const empty = await h.openPanel();
await prep(empty);
await shot(empty, "05-analysis-nojob");
await empty.close();

const jobPage = await h.context.newPage();
await jobPage.goto(`${h.baseUrl}/panel-job.html`);
await jobPage.waitForTimeout(500);
const panel = await h.openPanel();
const tabId = await panel.evaluate(async () => (await chrome.tabs.query({})).find((tab) => tab.url?.includes("panel-job"))?.id);
await panel.goto(`chrome-extension://${h.extensionId}/sidepanel.html?tabId=${tabId}`);
await prep(panel);
await panel.locator(".ring").waitFor({ timeout: 20000 });
await shot(panel, "06-analysis-job");
await panel.getByRole("button", { name: "★ Shortlist" }).click();
await panel.getByRole("tab", { name: "Apply" }).click();
await shot(panel, "07-apply");
const write = panel.getByRole("tabpanel", { name: "Apply" });
await write.getByRole("button", { name: "Generate" }).first().click().catch(() => {});
await panel.waitForTimeout(1500);
await shot(panel, "08-apply-generated");
await panel.getByRole("tab", { name: "Track" }).click();
await shot(panel, "09-track");
await panel.getByRole("tab", { name: "Profile", exact: true }).click();
await shot(panel, "10-profile");
await panel.getByRole("tab", { name: "Settings" }).click();
await shot(panel, "11-settings");

// 2b. narrow panel, scrolled bottom, expanded profile
await panel.setViewportSize({ width: 340, height: 760 });
await panel.getByRole("tab", { name: "Analysis" }).click();
await shot(panel, "06b-analysis-narrow");
await panel.getByRole("tab", { name: "Apply" }).click();
await panel.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await panel.waitForTimeout(300);
await panel.screenshot({ path: `${outDir}/${scheme}-07b-apply-bottom-viewport.png` });
await panel.getByRole("tab", { name: "Track" }).click();
await panel.getByText("Cover letter", { exact: true }).last().click().catch(() => {});
await shot(panel, "09b-track-narrow-open");
await panel.setViewportSize({ width: 400, height: 860 });
await panel.getByRole("tab", { name: "Profile", exact: true }).click();
for (const name of ["Resume & LinkedIn", "Links", "Professional", "Salary & notice", "Skills", "Experience (0)"]) await panel.getByText(name, { exact: true }).first().click().catch(() => {});
await shot(panel, "10b-profile-open");

// 3. AI error banner
await h.seed({ settings: { provider: { ...provider, baseUrl: "http://localhost:1/v1" }, autoFillOnPageChange: false, autoAnalyze: false, salarySearch: false } });
const broken = await h.openPanel();
await prep(broken);
await broken.getByRole("tab", { name: "Settings" }).click();
await broken.getByRole("button", { name: "Test connection" }).click().catch(() => {});
await broken.waitForTimeout(2500);
await shot(broken, "12-ai-error");
await broken.close();
await h.seed({ settings: { provider, autoFillOnPageChange: false, autoAnalyze: true, salarySearch: false } });

// 4. Super Job
const sj = await h.context.newPage();
await prep(sj, 1440, 900);
await sj.goto(`chrome-extension://${h.extensionId}/superjob.html`);
await sj.getByRole("textbox", { name: "Role" }).waitFor({ timeout: 15000 });
await shot(sj, "13-superjob-home");
await sj.getByRole("textbox", { name: "Role" }).fill("Software Engineer");
await sj.getByRole("button", { name: "Search", exact: true }).click();
await sj.waitForTimeout(12000);
await shot(sj, "14-superjob-results");
await sj.getByRole("button", { name: /^Instahyre/ }).click().catch(() => {});
await sj.getByRole("button", { name: /^Greenhouse/ }).click().catch(() => {});
await sj.waitForTimeout(800);
await shot(sj, "14b-superjob-filtered");
await sj.locator(".sj-row").nth(1).click().catch(() => {});
await sj.waitForTimeout(15000);
await shot(sj, "15-superjob-detail");
await prep(sj, 760, 900);
await shot(sj, "16-superjob-narrow");

await h.close();
llm.stop();
process.exit(0);
