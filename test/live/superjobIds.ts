// The id Super Job gives a listing must equal the id the content script gives it in a real tab: `bun run build && bun test/live/superjobIds.ts`.
import * as harness from "../e2e/harness.ts";

const query = { role: process.env.ROLE ?? "Engineering Manager", location: process.env.LOCATION ?? "Bengaluru" };
const portals = ["LinkedIn", "Naukri"];
const sourcesBundle = "/jobSourcesLive.js";
const postingBundle = "/postingLive.js";

const bundle = await Bun.build({ entrypoints: ["src/superjob/jobSources.ts", "src/superjob/posting.ts"], outdir: "dist", target: "browser", format: "esm", naming: "[name]Live.js" });
if (!bundle.success) throw new Error(bundle.logs.join("\n"));

const run = await harness.launch({ headless: false });
const page = await run.context.newPage();
await page.goto(`chrome-extension://${run.extensionId}/superjob.html`);

interface Found {
  url: string;
  title: string;
}

async function firstResult(name: string): Promise<Found | null> {
  return page.evaluate(
    async ({ name, query, sourcesBundle }) => {
      const sources = await import(sourcesBundle);
      const jobs = await sources.forCountry("india").find((source: { name: string }) => source.name === name).search(query);
      return jobs[0] ?? null;
    },
    { name, query, sourcesBundle },
  );
}

async function pageId(job: Found): Promise<{ id: string; descriptionLength: number }> {
  return page.evaluate(async ({ job, postingBundle }) => {
    const posting = await import(postingBundle);
    const loaded = await posting.load(job);
    return { id: loaded.id, descriptionLength: loaded.description.length };
  }, { job, postingBundle });
}

async function realTabId(url: string): Promise<string> {
  const tab = await run.context.newPage();
  await tab.goto(url, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  const urlPart = new URL(url).pathname;
  for (let attempt = 0; attempt < 10; attempt++) {
    await tab.waitForTimeout(2000);
    const extracted = (await harness.sendToTab(page, urlPart, { type: "extractJob" })).find((response) => !!response) as { id: string } | undefined;
    if (extracted) return (await tab.close(), extracted.id);
  }
  await tab.close();
  return "(no job extracted)";
}

for (const name of portals) {
  const job = await firstResult(name);
  if (!job) {
    console.log(`${name}: no results`);
    continue;
  }
  const fromPage = await pageId(job);
  const fromTab = await realTabId(job.url);
  console.log(`${name}: ${job.title}\n  url        ${job.url}\n  page id    ${fromPage.id}  (description ${fromPage.descriptionLength} chars)\n  real tab   ${fromTab}\n  ${fromPage.id === fromTab ? "EQUAL" : "DIFFERENT"}`);
}

const foundit = await firstResult("Foundit");
console.log(`Foundit first job url: ${foundit?.url}`);
await run.close();
