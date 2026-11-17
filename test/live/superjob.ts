// Every Super Job source against the real portals, inside the loaded extension: `bun run build && bun test/live/superjob.ts`.
import * as harness from "../e2e/harness.ts";

const query = { role: process.env.ROLE ?? "Engineering Manager", location: process.env.LOCATION ?? "Bengaluru" };
const country = process.env.COUNTRY ?? "india";
const jobIndex = Number(process.env.JOB ?? 0);

const bundle = await Bun.build({ entrypoints: ["src/superjob/jobSources.ts"], outdir: "dist", target: "browser", format: "esm", naming: "superjobLive.js" });
if (!bundle.success) throw new Error(bundle.logs.join("\n"));

const run = await harness.launch({ headless: false });
const page = await run.context.newPage();
await page.goto(`chrome-extension://${run.extensionId}/superjob.html`);

const bundlePath = "/superjobLive.js";
const names = await page.evaluate(async ({ bundlePath, country }) => {
  const sources = await import(bundlePath);
  return sources.forCountry(country).map((source: { name: string }) => source.name);
}, { bundlePath, country });

for (const name of names as string[]) {
  const report = await page.evaluate(
    async ({ bundlePath, name, query, country, jobIndex }) => {
      const sources = await import(bundlePath);
      const source = sources.forCountry(country).find((candidate: { name: string }) => candidate.name === name);
      try {
        const jobs = await source.search(query);
        const target = jobs[jobIndex];
        const description = target ? await sources.describe(target) : "";
        return { count: jobs.length, titles: jobs.slice(0, 5).map((job: { title: string }) => job.title), first: target, descriptionLength: description.length, descriptionStart: description.slice(0, 120) };
      } catch (error) {
        return { error: (error as Error).message };
      }
    },
    { bundlePath, name, query, country, jobIndex },
  );
  console.log(`\n=== ${name}\n${JSON.stringify(report, null, 1)}`);
}
await run.close();
