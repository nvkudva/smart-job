import * as http from "./http.ts";
import type { FoundJob, SearchQuery, Source } from "./jobSources.ts";
import * as plainText from "./plainText.ts";

const name = "LinkedIn";
const pageSize = 10;
const listUrl = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";
const detailUrl = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/";

function parseCard(card: Element): FoundJob | undefined {
  const portalId = card.getAttribute("data-entity-urn")?.split(":").pop() ?? "";
  const title = plainText.line(card.querySelector(".base-search-card__title"));
  const href = card.querySelector("a.base-card__full-link")?.getAttribute("href") ?? "";
  if (!portalId || !title || !href) return undefined;
  const link = new URL(href);
  link.search = "";
  const logo = card.querySelector("img");
  return {
    id: `${name}:${portalId}`,
    source: name,
    title,
    company: plainText.line(card.querySelector(".base-search-card__subtitle")),
    location: plainText.line(card.querySelector(".job-search-card__location")),
    url: link.href,
    posted: plainText.line(card.querySelector("time")),
    salary: plainText.line(card.querySelector(".job-search-card__salary-info")),
    snippet: "",
    logoUrl: logo?.getAttribute("data-delayed-url") ?? logo?.getAttribute("src") ?? "",
  };
}

export function parseList(raw: string): FoundJob[] {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  const jobs: FoundJob[] = [];
  for (const card of doc.querySelectorAll("[data-entity-urn]")) {
    const job = parseCard(card);
    if (job) jobs.push(job);
  }
  return jobs;
}

export function parseDescription(raw: string): string {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  const markup = doc.querySelector(".show-more-less-html__markup");
  return markup ? plainText.block(markup) : "";
}

async function search(query: SearchQuery, page: number): Promise<FoundJob[]> {
  const params = `keywords=${encodeURIComponent(query.role)}&location=${encodeURIComponent(query.location)}&start=${page * pageSize}`;
  return parseList(await http.text(name, `${listUrl}?${params}`));
}

async function describe(job: FoundJob): Promise<string> {
  const description = parseDescription(await http.text(name, detailUrl + job.id.slice(name.length + 1)));
  if (!description) throw new Error(`${name} shows no description for this job`);
  return description;
}

export const source: Source = { name, countries: [], search, describe };
