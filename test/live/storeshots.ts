// README + Chrome Web Store images with a fictional persona and fictional companies:
//   bun run build && bun test/live/storeshots.ts
// Writes docs/screenshots/*.png (1280x800 scenes, also used by the README) and store/*.png (listing assets).
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "playwright";
import { defaultSettings, emptyProfile } from "../../src/storage.ts";
import type { JobAnalysis, JobPosting, TrackedJob } from "../../src/types.ts";
import * as harness from "../e2e/harness.ts";

const root = resolve(import.meta.dir, "../..");
const scenesDir = `${root}/docs/screenshots`;
const rawDir = `${root}/docs/screenshots/raw`;
const storeDir = `${root}/store`;
await mkdir(rawDir, { recursive: true });
await mkdir(storeDir, { recursive: true });

const contentHeight = 584;
const pageWidth = 760;
const panelWidth = 420;
const day = 86_400_000;

const coverLetter = `Dear Cobalt Harbor team,

I have spent six years building dispatcher-grade web apps in TypeScript and React, most recently a live fleet planner used by 4,000 operators at Nimbus Freight. Your planner UI sounds like the same kind of problem: dense data, maps and timelines that must stay fast.

I cut that planner's render time by 60% and moved its end-to-end suite to Playwright, which is exactly the testing practice your posting asks for. I also mentor two junior engineers and enjoy reviewing code.

I would love to bring that experience to your team in Seattle.

Maya Chen`;

const whyCobalt =
  "Cobalt Harbor works on the same problem I know best: helping dispatchers make fast decisions from dense, live data. I have built a fleet planner like that for six years, and the chance to own the planner UI at your scale, with a team that cares about accessibility and testing, is the work I want to do next.";

/** Local OpenAI-compatible server with believable replies for the two AI calls these scenes trigger. */
function startLlm() {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.method !== "POST") return Response.json({ data: [{ id: "qwen2.5:7b" }] });
      const body = (await request.json()) as { messages: { role: string; content: string }[] };
      const system = body.messages.find((message) => message.role === "system")?.content ?? "";
      const user = body.messages.at(-1)?.content ?? "";
      let content = "OK";
      if (system.includes("write short, modern cover letters")) content = coverLetter;
      if (system.includes("fill in job application form fields")) {
        const fields = user.split("\n").flatMap((line) => {
          try {
            return [JSON.parse(line) as { id: string; label: string }];
          } catch {
            return [];
          }
        });
        const why = fields.find((field) => /why do you want/i.test(field.label));
        content = JSON.stringify({ answers: why ? { [why.id]: whyCobalt } : {} });
      }
      return Response.json({ choices: [{ message: { content } }] });
    },
  });
  return { baseUrl: `http://localhost:${server.port}/v1`, stop: () => server.stop(true) };
}

const profile = {
  ...emptyProfile,
  firstName: "Maya",
  lastName: "Chen",
  email: "maya.chen@example.com",
  phone: "206 555 0142",
  phoneCountryCode: "+1",
  city: "Seattle",
  state: "WA",
  country: "United States",
  linkedin: "linkedin.com/in/mayachen-demo",
  headline: "Senior Frontend Engineer",
  currentTitle: "Senior Frontend Engineer",
  currentCompany: "Nimbus Freight",
  yearsExperience: 6,
  skills: ["TypeScript", "React", "Preact", "Playwright", "GraphQL", "Accessibility", "Performance", "WebGL"],
  workAuthorized: "yes" as const,
  requiresSponsorship: "no" as const,
  noticePeriod: "4 weeks",
  experience: [
    { title: "Senior Frontend Engineer", company: "Nimbus Freight", location: "Seattle, WA", start: "2022-03", end: "", current: true, description: "Own the live fleet planner used by 4,000 operators." },
    { title: "Frontend Engineer", company: "Tidewater Apps", location: "Portland, OR", start: "2019-06", end: "2022-02", current: false, description: "Built a design system and the customer dashboard." },
  ],
};
const resume = { text: "Maya Chen. Senior Frontend Engineer. TypeScript, React, Playwright, GraphQL.", fileName: "Maya_Chen_Resume.pdf", fileBase64: "", mimeType: "application/pdf" };

function analysisFor(overrides: Partial<JobAnalysis>): JobAnalysis {
  return {
    summary: "",
    mustHave: [],
    niceToHave: [],
    matchScore: 80,
    keywordScore: 70,
    matchedSkills: [],
    missingSkills: [],
    verdict: "Strong match - apply",
    salary: null,
    analyzedAt: Date.now(),
    ...overrides,
  };
}

const cobaltAnalysis = analysisFor({
  matchScore: 87,
  keywordScore: 82,
  reason: "Your TypeScript, React and Playwright work lines up with every core requirement.",
  seniority: "match",
  overview: {
    company: ["You would join a logistics software company that plans container moves for ports and shipping lines."],
    position: ["You would own the dispatcher planner UI: maps, timelines and tables used by thousands of operators.", "You would lead reviews for a team of six."],
  },
  mustHave: ["5+ years of TypeScript in production", "Deep React and performance tuning", "Testing with Playwright or Vitest"],
  mustHaveMet: ["yes", "yes", "yes"],
  niceToHave: ["GraphQL", "Map rendering or WebGL", "Mentoring juniors"],
  niceToHaveMet: ["yes", "partial", "yes"],
  matchedSkills: ["TypeScript", "React", "Playwright", "GraphQL", "Performance"],
  missingSkills: ["Map rendering"],
  salary: {
    min: 165000,
    max: 205000,
    currency: "USD",
    period: "year",
    basis: "estimate",
    note: "AI estimate from nearest equivalents: senior frontend roles in Seattle",
    sources: [],
    components: { base: { min: 150000, max: 180000 }, bonus: { min: 10000, max: 15000 }, stock: { min: 5000, max: 10000 }, total: { min: 165000, max: 205000 } },
  },
  perks: {
    items: [
      { category: "Work mode", text: "Hybrid, 2 days in office" },
      { category: "Health", text: "Health, dental, vision paid 100%" },
      { category: "Leave", text: "25 days paid leave" },
      { category: "Growth", text: "Yearly learning budget" },
    ],
    sources: [],
  },
});

function trackedJob(id: string, title: string, company: string, location: string, status: TrackedJob["status"], score: number, salary: [number, number], daysAgo: number, notes = ""): TrackedJob {
  const job: JobPosting = { id, url: `https://example.com/jobs/${id}`, title, company, location, description: "", salaryText: "", employmentType: "Full-time", source: "generic" };
  const savedAt = Date.now() - daysAgo * day;
  const analysis = analysisFor({
    matchScore: score,
    verdict: score >= 70 ? "Strong match - apply" : "Possible match - stretch",
    salary: { min: salary[0], max: salary[1], currency: "USD", period: "year", basis: "estimate", note: "AI estimate", sources: [] },
  });
  return { job, analysis, status, notes, savedAt, updatedAt: savedAt, coverLetter: "" };
}

const llm = startLlm();
const h = await harness.launch({ deviceScaleFactor: 2 });
const demoSettings = { ...defaultSettings, autoAnalyze: false, provider: { kind: "openai" as const, baseUrl: llm.baseUrl, apiKey: "", model: "qwen2.5:7b" } };
await h.seed({ settings: demoSettings, profile, resume, setupComplete: true });

/** Retina comes from the context's deviceScaleFactor, so text stays sharp when the scene is composited. */
async function setSize(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
}

async function openSite(fixture: string): Promise<{ page: Page; tabId: number }> {
  const page = await h.context.newPage();
  await setSize(page, pageWidth, contentHeight);
  await page.goto(`${h.baseUrl}/${fixture}`);
  await page.waitForTimeout(600);
  const probe = await h.openPanel();
  const tabId = (await probe.evaluate(async (part) => (await chrome.tabs.query({})).find((tab) => tab.url?.includes(part))?.id, fixture)) as number;
  await probe.close();
  return { page, tabId };
}

async function openPanelFor(tabId: number): Promise<Page> {
  const panel = await h.context.newPage();
  await setSize(panel, panelWidth, contentHeight);
  await panel.goto(`chrome-extension://${h.extensionId}/sidepanel.html?tabId=${tabId}`);
  return panel;
}

async function shotPanel(panel: Page, tab: string, name: string, scrollTo?: string | number): Promise<void> {
  await panel.getByRole("tab", { name: tab }).click();
  await panel.waitForTimeout(500);
  if (typeof scrollTo === "number") await panel.evaluate((offset) => window.scrollTo(0, offset), scrollTo);
  else if (scrollTo) {
    await panel.getByText(scrollTo, { exact: true }).first().evaluate((element) => element.scrollIntoView({ block: "start" }));
    await panel.evaluate(() => window.scrollBy(0, -80)); // keep the section title below the sticky tab bar
  }
  await panel.waitForTimeout(300);
  await panel.screenshot({ path: `${rawDir}/panel-${name}.png` });
}

// 1. Analysis of the job posting (cached analysis, so no AI call is needed)
const jobSite = await openSite("demo-job.html");
const [posting] = (await harness.sendToTab(await h.openPanel(), "demo-job", { type: "extractJob" })) as JobPosting[];
if (!posting) throw new Error("demo job page was not detected as a job");
await h.seed({ analyses: { [posting.id]: cobaltAnalysis } });
await jobSite.page.screenshot({ path: `${rawDir}/site-job.png` });
const jobPanel = await openPanelFor(jobSite.tabId);
await jobPanel.waitForTimeout(3500);
await shotPanel(jobPanel, "Analysis", "analysis");
await shotPanel(jobPanel, "Analysis", "analysis-details", "Must have");
await shotPanel(jobPanel, "Analysis", "analysis-pay", "Salary");

// 2. Autofill on the application form, then a cover letter
const applySite = await openSite("demo-apply.html");
const applyPanel = await openPanelFor(applySite.tabId);
await applyPanel.waitForTimeout(3000);
await applyPanel.getByRole("tab", { name: "Apply" }).click();
await applySite.page.evaluate(() => window.scrollTo(0, 330));
await applySite.page.screenshot({ path: `${rawDir}/site-apply-before.png` });
await shotPanel(applyPanel, "Apply", "apply-before");
console.log("fill button box", JSON.stringify(await applyPanel.getByRole("button", { name: "Start applying" }).boundingBox()));
await applyPanel.getByRole("button", { name: "Start applying" }).click();
await applyPanel.getByText("Filled").first().waitFor({ timeout: 30000 });
await applyPanel.waitForTimeout(1500);
await applySite.page.evaluate(() => window.scrollTo(0, 330));
await applySite.page.screenshot({ path: `${rawDir}/site-apply.png` });
await shotPanel(applyPanel, "Apply", "apply", 650);

await applyPanel.getByRole("button", { name: "Generate" }).first().click();
await applyPanel.getByLabel("Cover letter text").waitFor({ timeout: 30000 });
await shotPanel(applyPanel, "Apply", "write", "Cover letter");

// 3. Tracker with a realistic pipeline
await h.seed({
  jobs: {
    [posting.id]: { ...trackedJob(posting.id, posting.title, posting.company, "Seattle, WA", "saved", 87, [165000, 205000], 0), job: { ...posting, url: "https://careers.cobaltharbor.example/senior-frontend-engineer" }, analysis: cobaltAnalysis },
    a1: trackedJob("a1", "Staff Frontend Engineer", "Brightwave Systems", "Remote, US", "interview", 91, [190000, 235000], 12, "Round 2 on Thursday: system design."),
    a2: trackedJob("a2", "Senior UI Engineer", "Fernhill Health", "Portland, OR", "applied", 78, [150000, 185000], 6),
    a3: trackedJob("a3", "Frontend Platform Engineer", "Orbit Pay", "Remote, US", "applied", 74, [160000, 200000], 4),
    a4: trackedJob("a4", "Design Systems Engineer", "Kite Analytics", "San Francisco, CA", "saved", 69, [170000, 210000], 2),
  },
});
const trackerPanel = await openPanelFor(jobSite.tabId);
await trackerPanel.waitForTimeout(2500);
await shotPanel(trackerPanel, "Track", "tracker");

// 4. Profile and settings (local AI preset shown, nothing leaves the machine)
await h.seed({ settings: { ...demoSettings, autoAnalyze: true, provider: { kind: "openai", baseUrl: "http://localhost:11434/v1", apiKey: "", model: "qwen2.5:7b" } } });
const settingsPanel = await openPanelFor(jobSite.tabId);
await settingsPanel.waitForTimeout(2500);
await shotPanel(settingsPanel, "Profile", "profile");
await shotPanel(settingsPanel, "Settings", "settings");

await h.close();
llm.stop();


const iconSvg = await Bun.file(`${root}/assets/icon.svg`).text();
const dataUrl = async (path: string) => `data:image/png;base64,${Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64")}`;

const frameStyle = `
  *{box-sizing:border-box;margin:0}body{width:1280px;height:800px;overflow:hidden;font-family:-apple-system,"SF Pro Display","Segoe UI",Helvetica,Arial,sans-serif;color:#fff;
  background:radial-gradient(900px 500px at 85% -10%,#2f6bff 0%,transparent 60%),radial-gradient(700px 500px at -10% 110%,#00b59a55 0%,transparent 60%),#0a1530}
  h1{position:absolute;left:56px;top:34px;font-size:46px;letter-spacing:-.02em;font-weight:800}
  p.sub{position:absolute;left:58px;top:94px;font-size:21px;color:#b8c6e6}
  .win{position:absolute;left:50px;top:146px;width:1180px;height:620px;border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 30px 80px #0008,0 0 0 1px #ffffff22}
  .bar{height:36px;background:#e9edf5;display:flex;align-items:center;gap:8px;padding:0 14px}
  .bar i{width:12px;height:12px;border-radius:50%;background:#c4cada}.bar span{margin:0 auto;transform:translateX(-30px);background:#fff;border-radius:8px;padding:3px 60px;color:#5b6478;font-size:13px}
  .body{display:flex;height:584px}.body img{height:584px;display:block}`;

async function sceneHtml(headline: string, sub: string, site: string, panel: string, url: string): Promise<string> {
  return `<style>${frameStyle}</style><h1>${headline}</h1><p class="sub">${sub}</p>
  <div class="win"><div class="bar"><i></i><i></i><i></i><span>${url}</span></div>
  <div class="body"><img src="${await dataUrl(`${rawDir}/${site}.png`)}" width="760"><img src="${await dataUrl(`${rawDir}/${panel}.png`)}" width="420"></div></div>`;
}

const scenes: [file: string, headline: string, sub: string, site: string, panel: string, url: string][] = [
  ["1-match-score", "Know if a job is worth your time", "An instant match score against your resume, with what is covered and what is missing.", "site-job", "panel-analysis", "careers.cobaltharbor.example/senior-frontend-engineer"],
  ["2-pay-and-perks", "See pay and perks before you apply", "Posted pay, or a clearly labelled estimate, plus the benefits the posting states.", "site-job", "panel-analysis-pay", "careers.cobaltharbor.example/senior-frontend-engineer"],
  ["3-autofill", "Autofill the application. You press Submit.", "Fields are filled from your profile, AI answers the rest, and every field is colour-coded.", "site-apply", "panel-apply", "careers.cobaltharbor.example/apply"],
  ["4-cover-letter", "A cover letter written for this job", "Short, keyword-aware, in your tone. Tailor your resume the same way.", "site-apply", "panel-write", "careers.cobaltharbor.example/apply"],
  ["5-tracker", "Track every application in one place", "Shortlist, status, notes and CSV export. Everything stays on your device.", "site-job", "panel-tracker", "careers.cobaltharbor.example/senior-frontend-engineer"],
];

const tagline = "Your AI sidekick for job search and apply";

async function promoHtml(width: number, height: number, isWide: boolean): Promise<string> {
  const panel = await dataUrl(`${rawDir}/panel-analysis.png`);
  const side = isWide ? `<img src="${panel}" style="position:absolute;right:70px;top:60px;width:380px;border-radius:14px;box-shadow:0 20px 60px #0008">` : "";
  return `<style>*{box-sizing:border-box;margin:0}body{width:${width}px;height:${height}px;overflow:hidden;font-family:-apple-system,"SF Pro Display",Helvetica,Arial,sans-serif;color:#fff;position:relative;
  background:radial-gradient(60% 90% at 90% 0%,#2f6bff 0%,transparent 70%),radial-gradient(50% 70% at 0% 100%,#00b59a66 0%,transparent 70%),#0a1530}
  .logo{position:absolute;left:${isWide ? 70 : 36}px;top:${isWide ? 110 : 40}px;width:${isWide ? 96 : 64}px}.logo svg{width:100%;height:auto}
  h1{position:absolute;left:${isWide ? 70 : 36}px;top:${isWide ? 230 : 120}px;font-size:${isWide ? 76 : 44}px;font-weight:800;letter-spacing:-.02em}
  p{position:absolute;left:${isWide ? 72 : 38}px;top:${isWide ? 330 : 180}px;width:${isWide ? 620 : 370}px;font-size:${isWide ? 30 : 21}px;line-height:1.3;color:#c3d0ee}</style>
  <div class="logo">${iconSvg}</div><h1>SmartJob</h1><p>${tagline}</p>${side}`;
}

async function compose(): Promise<void> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ channel: "chromium" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  for (const [file, headline, sub, site, panel, url] of scenes) {
    await page.setContent(await sceneHtml(headline, sub, site, panel, url));
    await page.screenshot({ path: `${scenesDir}/${file}.png` });
    await page.screenshot({ path: `${storeDir}/screenshot-${file}.png` });
  }
  for (const [file, width, height, isWide] of [["promo-small-440x280", 440, 280, false], ["promo-marquee-1400x560", 1400, 560, true]] as const) {
    await page.setViewportSize({ width, height });
    await page.setContent(await promoHtml(width, height, isWide));
    await page.screenshot({ path: `${storeDir}/${file}.png` });
  }
  await browser.close();
}

// Compose scenes and listing assets (plain Chromium, no extension)
await compose();
console.log("wrote", scenesDir, storeDir);
