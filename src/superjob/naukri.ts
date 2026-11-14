import * as hiddenTab from "./hiddenTab.ts";
import type { FoundJob, SearchQuery, Source } from "./jobSources.ts";
import * as plainText from "./plainText.ts";
import * as slug from "./slug.ts";

const name = "Naukri";
const origin = "https://www.naukri.com";
const listSelector = 'ul[aria-label="Job search results"]';
const cardSelector = ".srp-jobtuple-wrapper";
const descriptionSelector = '[class*="job-desc-container"]';

function parseCard(card: Element): FoundJob | undefined {
  const link = card.querySelector("a.title");
  const portalId = card.getAttribute("data-job-id") ?? "";
  const url = link?.getAttribute("href") ?? "";
  const title = plainText.line(link);
  if (!portalId || !url || !title) return undefined;
  return {
    id: `${name}:${portalId}`,
    source: name,
    title,
    company: plainText.line(card.querySelector(".comp-name")),
    location: plainText.line(card.querySelector(".locWdth")),
    url,
    posted: plainText.line(card.querySelector(".job-post-day")),
    salary: plainText.line(card.querySelector(".sal-wrap")),
    snippet: plainText.line(card.querySelector(".job-desc")),
    logoUrl: card.querySelector("img.logoImage")?.getAttribute("src") ?? "",
  };
}

export function parseList(raw: string): FoundJob[] {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  const jobs: FoundJob[] = [];
  for (const card of doc.querySelectorAll(cardSelector)) {
    const job = parseCard(card);
    if (job) jobs.push(job);
  }
  return jobs;
}

export function parseDescription(raw: string): string {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  const container = doc.querySelector('[class*="dang-inner-html"]') ?? doc.body;
  return plainText.block(container);
}

function search(query: SearchQuery, page: number): Promise<FoundJob[]> {
  const place = query.location.trim() ? `-in-${slug.of(query.location)}` : "";
  const pageSuffix = page ? `-${page + 1}` : "";
  const url = `${origin}/${slug.of(query.role)}-jobs${place}${pageSuffix}`;
  return hiddenTab.read(name, url, cardSelector, listSelector).then(parseList);
}

async function describe(job: FoundJob): Promise<string> {
  const description = parseDescription(await hiddenTab.read(name, job.url, descriptionSelector, descriptionSelector));
  return description || job.snippet;
}

export const source: Source = { name, countries: ["india"], search, describe };
