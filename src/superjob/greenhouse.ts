import * as hiddenTab from "./hiddenTab.ts";
import * as http from "./http.ts";
import type { FoundJob, SearchQuery, Source } from "./jobSources.ts";
import * as plainText from "./plainText.ts";

const name = "Greenhouse";
const origin = "https://my.greenhouse.io";
const loginUrl = `${origin}/users/sign_in`;
const jobLinkSelector = 'a[href*="greenhouse.io/"][href*="/jobs/"], a[href*="gh_jid="]';
const boardJobPattern = /(?:job-boards|boards)\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/;
const signedOutMarker = "SIGNED_OUT";
const readyTimeoutMs = 15000;

/** Runs inside the page: the search needs a signed-in session, so a redirect to sign-in ends the wait. Must stay self-contained. */
async function readResults(linkSelector: string, signedOut: string, timeoutMs: number): Promise<string> {
  for (let waited = 0; waited < timeoutMs; waited += 500) {
    if (location.pathname.includes("sign_in")) return signedOut;
    if (document.querySelector(linkSelector)) return document.body.outerHTML;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return "";
}

function parseCard(anchor: Element): FoundJob | undefined {
  const url = anchor.getAttribute("href") ?? "";
  const card = anchor.closest("li, article, [class*='card'], [class*='job']") ?? anchor;
  const [title = "", company = "", location = ""] = plainText.block(card).split("\n").filter(Boolean);
  const portalId = boardJobPattern.exec(url)?.[2] ?? /gh_jid=(\d+)/.exec(url)?.[1] ?? "";
  if (!portalId || !title) return undefined;
  return { id: `${name}:${portalId}`, source: name, title, company, location, url, posted: "", salary: "", snippet: "", logoUrl: card.querySelector("img")?.getAttribute("src") ?? "" };
}

export function parseList(raw: string): FoundJob[] {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  const jobs: FoundJob[] = [];
  const knownIds = new Set<string>();
  for (const anchor of doc.querySelectorAll(jobLinkSelector)) {
    const job = parseCard(anchor);
    if (!job || knownIds.has(job.id)) continue;
    knownIds.add(job.id);
    jobs.push(job);
  }
  return jobs;
}

async function search(query: SearchQuery, page: number): Promise<FoundJob[]> {
  const params = `query=${encodeURIComponent(query.role)}&location=${encodeURIComponent(query.location)}&page=${page + 1}`;
  const html = await hiddenTab.run(`${origin}/jobs?${params}`, readResults, [jobLinkSelector, signedOutMarker, readyTimeoutMs]);
  if (html === signedOutMarker) throw new http.SignInRequired(loginUrl);
  if (!html) throw new Error(`${name} did not load in time`);
  return parseList(html);
}

async function describe(job: FoundJob): Promise<string> {
  const [, board, jobId] = boardJobPattern.exec(job.url) ?? [];
  if (!board) throw new Error(`${name} shows no description for this job`);
  const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${jobId}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${name} answered ${response.status}`);
  const { content = "" } = (await response.json()) as { content?: string };
  const markup = new DOMParser().parseFromString(content, "text/html").body.textContent ?? "";
  return plainText.block(new DOMParser().parseFromString(markup, "text/html").body);
}

export const source: Source = { name, countries: [], search, describe };
