// Job extraction against real public pages: `bun run build && bun test/live/realjobs.ts`.
import type { Page } from "playwright";
import type { JobPosting } from "../../src/types.ts";
import * as harness from "../e2e/harness.ts";

const boards: Record<string, { board: string; link: string }> = {
  linkedin: { board: "https://www.linkedin.com/jobs/search?keywords=software%20engineer&location=United%20States", link: "a.base-card__full-link" },
  workday: { board: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite", link: 'a[data-automation-id="jobTitle"]' },
  greenhouse: { board: "https://job-boards.greenhouse.io/anthropic", link: 'a[href*="/jobs/"]' },
  lever: { board: "https://jobs.lever.co/palantir", link: "a.posting-title" },
};

async function openFirstJob(page: Page, site: string): Promise<void> {
  const { board, link } = boards[site]!;
  await page.goto(board, { waitUntil: "domcontentloaded" });
  const href = await page.locator(link).first().getAttribute("href", { timeout: 20000 });
  await page.goto(new URL(href!, page.url()).href, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
}

const h = await harness.launch();
const panel = await h.openPanel();
for (const site of (process.env.SITES ?? Object.keys(boards).join(",")).split(",")) {
  const page = await h.context.newPage();
  try {
    await openFirstJob(page, site);
    const results = (await harness.sendToTab(panel, page.url().split("?")[0]!, { type: "extractJob" })) as (JobPosting | null)[];
    const job = results.find(Boolean);
    console.log(`\n=== ${site}: ${page.url()}`);
    if (!job) console.log("NO JOB EXTRACTED");
    else console.log(JSON.stringify({ ...job, description: `${job.description.length} chars: ${job.description.slice(0, 120)}` }, null, 1));
  } catch (error) {
    console.log(`${site} failed: ${(error as Error).message.split("\n")[0]}`);
  }
  await page.close();
}
await h.close();
