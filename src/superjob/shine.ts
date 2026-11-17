import * as http from "./http.ts";
import * as jobPosting from "./jobPosting.ts";
import type { FoundJob, SearchQuery, Source } from "./jobSources.ts";
import * as plainText from "./plainText.ts";
import * as slug from "./slug.ts";

const name = "Shine";
const origin = "https://www.shine.com";
const notDisclosed = /not disclosed/i;

function skillsOf(card: Element): string {
  const skills: string[] = [];
  for (const item of card.querySelectorAll('[class*="result-card_skills-item"]')) skills.push(plainText.line(item).replace(/^·\s*/, ""));
  return skills.join(", ");
}

function parseCard(card: Element): FoundJob | undefined {
  const url = card.querySelector('meta[itemprop="url"]')?.getAttribute("content") ?? "";
  const title = plainText.line(card.querySelector("h3"));
  if (!url || !title) return undefined;
  const [, salary = "", location = ""] = [...card.querySelectorAll('[class*="result-card_meta-text"]')].map(plainText.line);
  return {
    id: `${name}:${url.split("/").pop()}`,
    source: name,
    title,
    company: plainText.line(card.querySelector('[class*="result-card_company"]')),
    location,
    url,
    posted: plainText.line(card.querySelector('[class*="result-card_posted"]')),
    salary: notDisclosed.test(salary) ? "" : salary,
    snippet: skillsOf(card),
    logoUrl: "",
  };
}

export function parseList(raw: string): FoundJob[] {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  const jobs: FoundJob[] = [];
  for (const card of doc.querySelectorAll('article[itemprop="itemListElement"]')) {
    const job = parseCard(card);
    if (job) jobs.push(job);
  }
  return jobs;
}

export const parseDescription = jobPosting.description;

async function search(query: SearchQuery, page: number): Promise<FoundJob[]> {
  const place = query.location.trim() ? `-in-${slug.of(query.location)}` : "";
  return parseList(await http.text(name, `${origin}/job-search/${slug.of(query.role)}-jobs${place}${page ? `-${page + 1}` : ""}`));
}

async function describe(job: FoundJob): Promise<string> {
  const description = parseDescription(await http.text(name, job.url));
  if (!description) throw new Error(`${name} shows no description for this job`);
  return description;
}

export const source: Source = { name, countries: ["india"], search, describe };
