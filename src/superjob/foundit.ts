import * as hiddenTab from "./hiddenTab.ts";
import type { FoundJob, SearchQuery, Source } from "./jobSources.ts";
import * as plainText from "./plainText.ts";

const name = "Foundit";
const searchUrl = "https://www.foundit.in/srp/results";
const cardSelector = ".cardContainer";
const listSelector = ".srpCardContainer";
const pageSize = 15;

/** Runs inside the search page: selects the card (the page loads its description on click) and returns the description pane. Must stay self-contained. */
async function readJobPane(cardId: string): Promise<string> {
  const pause = () => new Promise((resolve) => setTimeout(resolve, 500));
  const readPane = () => document.querySelector("#jobDescription")?.textContent ?? "";
  for (let waited = 0; waited < 10000 && !document.getElementById(cardId); waited += 500) await pause();
  const card = document.getElementById(cardId);
  if (!card) return "";
  const isActive = card.classList.contains("activeCard");
  const before = isActive ? "" : readPane();
  if (!isActive) card.querySelector<HTMLElement>(".jobTitle")?.click();
  for (let waited = 0; waited < 8000 && (!readPane() || readPane() === before); waited += 500) await pause();
  return readPane() === before ? "" : (document.querySelector("#jobDescription")?.outerHTML ?? "");
}

function parseCard(card: Element, listUrl: string): FoundJob | undefined {
  const title = plainText.line(card.querySelector(".jobTitle"));
  if (!card.id || !title) return undefined;
  const [experience = ""] = [...card.querySelectorAll(".experienceSalary .details")].map(plainText.line);
  return {
    id: `${name}:${card.id}`,
    source: name,
    title,
    company: plainText.line(card.querySelector(".companyName")),
    location: plainText.line(card.querySelector(".details.location")),
    url: listUrl,
    isSearchUrl: true,
    posted: plainText.line(card.querySelector(".timeText")).replace(/^Posted /, ""),
    salary: "",
    snippet: experience ? `Experience: ${experience}` : "",
    logoUrl: card.querySelector(".companyLogo img")?.getAttribute("src") ?? "",
  };
}

/** listUrl is the search page: the portal gives cards no link of their own. */
export function parseList(raw: string, listUrl = searchUrl): FoundJob[] {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  const jobs: FoundJob[] = [];
  for (const card of doc.querySelectorAll(cardSelector)) {
    const job = parseCard(card, listUrl);
    if (job) jobs.push(job);
  }
  return jobs;
}

export function parseDescription(raw: string): string {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  const pane = doc.querySelector("#jobDescription");
  return pane ? plainText.block(pane) : "";
}

async function search(query: SearchQuery, page: number): Promise<FoundJob[]> {
  const place = query.location.trim() ? `&locations=${encodeURIComponent(query.location.trim())}` : "";
  const offset = page ? `&start=${page * pageSize}&limit=${pageSize}` : "";
  const url = `${searchUrl}?query=${encodeURIComponent(query.role)}${place}${offset}`;
  return parseList(await hiddenTab.read(name, url, cardSelector, listSelector), url);
}

async function describe(job: FoundJob): Promise<string> {
  const html = await hiddenTab.run(job.url, readJobPane, [job.id.slice(name.length + 1)]);
  if (!html) throw new Error(`${name} did not show this job in time`);
  return parseDescription(html);
}

export const source: Source = { name, countries: ["india"], search, describe };
