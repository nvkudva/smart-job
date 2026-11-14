import type { CompanyPerks, JobPosting } from "../types.ts";
import * as llm from "./llm.ts";
import * as normalize from "./normalize.ts";
import * as salary from "./salary.ts";
import type { SearchResult } from "./salary.ts";

export const categories = ["Work mode", "Health", "Leave", "Money", "Growth", "Other"];

const perkWords = /benefit|perk|remote|hybrid|work from home|wfh|insurance|health|medical|leave|vacation|\bpto\b|parental|401\(?k|wellness|stipend|equity|flexible|learning/i;

function queriesFor(company: string): string[] {
  return [`${company} employee benefits perks work from home hybrid insurance leave policy`, `${company} careers benefits`];
}

async function searchQuery(query: string, fetchPage: typeof fetch): Promise<SearchResult[]> {
  const bing = await salary.fetchResults(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`, salary.parseBingResults, fetchPage);
  if (bing.length) return bing;
  return salary.fetchResults(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, salary.parseSearchResults, fetchPage);
}

export async function searchWeb(company: string, fetchPage: typeof fetch = fetch): Promise<SearchResult[]> {
  const found = (await Promise.all(queriesFor(company).map((query) => searchQuery(query, fetchPage)))).flat();
  const seen = new Set<string>();
  const unique = found.filter((result) => !seen.has(result.url) && !!seen.add(result.url));
  return unique.filter((result) => perkWords.test(`${result.title} ${result.snippet}`)).slice(0, 8);
}

const perksSystem = `List the perks and benefits the company offers, from the job posting and the search snippets. Reply with JSON only:
{"perks": [{"category": "Work mode" | "Health" | "Leave" | "Money" | "Growth" | "Other", "text": "short phrase"}], "sourceIds": [2]}
- Work mode: remote, hybrid or on-site, and any office-days rule. Health: insurance, wellness. Leave: vacation, parental, sick. Money: bonus, equity, retirement, allowances. Growth: learning budget, training.
- Only perks the posting or a snippet states for this company; never invent or assume typical perks. Phrases of 2-8 words, with figures when given ("30 days paid leave").
- sourceIds are the [numbers] of the snippets you used; none if you used only the posting.
- No perks stated: {"perks": [], "sourceIds": []}. Be brief.`;

const benefitsHeading = /benefits?|perks|we offer|what you('|’)ll get|compensation/i;
const listLinesAfterHeading = 8;

/** Only the lines that mention perks, plus the list under a benefits heading; the rest of the posting is not perk evidence and is read by the analysis anyway. */
export function perkLines(description: string): string {
  const kept: string[] = [];
  let linesLeftUnderHeading = 0;
  for (const line of normalize.compact(description).split("\n")) {
    const isHeading = line.length < 80 && benefitsHeading.test(line);
    const isUnderHeading = linesLeftUnderHeading > 0;
    linesLeftUnderHeading = isHeading ? listLinesAfterHeading : Math.max(0, linesLeftUnderHeading - 1);
    if (isHeading || isUnderHeading || perkWords.test(line)) kept.push(line);
  }
  return kept.join("\n");
}

function buildPrompt(job: JobPosting, results: SearchResult[]): string {
  const snippets = results.map((result, index) => `[${index + 1}] ${result.title}\n${result.url}\n${normalize.truncate(result.snippet, 350)}`);
  const web = snippets.length ? `\n\nSearch results:\n${snippets.join("\n\n")}` : "";
  return `Company: ${job.company}\nJob: ${job.title}, ${job.location || "location unknown"}\n\nJob posting (perk lines only):\n${normalize.truncate(perkLines(job.description), 3000)}${web}`;
}

function categoryOf(value: unknown): string {
  const text = normalize.asString(value).toLowerCase();
  return categories.find((category) => category.toLowerCase() === text) ?? "Other";
}

export function normalizePerks(raw: unknown, results: SearchResult[]): CompanyPerks {
  const data = normalize.asRecord(raw);
  const list = Array.isArray(data.perks) ? data.perks : [];
  const seen = new Set<string>();
  const items = list
    .map((entry) => (typeof entry === "string" ? { category: "Other", text: entry } : { category: categoryOf(normalize.asRecord(entry).category), text: normalize.asString(normalize.asRecord(entry).text) }))
    .filter((item) => item.text && !seen.has(item.text.toLowerCase()) && !!seen.add(item.text.toLowerCase()))
    .slice(0, 16);
  const ids = (Array.isArray(data.sourceIds) ? data.sourceIds : []).map((id) => normalize.asNumber(id));
  const sources = results.filter((_, index) => ids.includes(index + 1)).slice(0, 4).map(({ title, url }) => ({ title, url }));
  return { items, sources };
}

export async function find(client: llm.LlmClient, job: JobPosting, options: { webSearch: boolean }, fetchPage: typeof fetch = fetch): Promise<CompanyPerks> {
  const results = options.webSearch && job.company ? await searchWeb(job.company, fetchPage) : [];
  // nothing in the posting or the search to read: skip the request, the answer would be empty
  if (!results.length && !perkLines(job.description) && !perkWords.test(job.location)) return { items: [], sources: [] };
  const raw = await llm.chatJson<unknown>(client, { system: perksSystem, user: buildPrompt(job, results), maxTokens: normalize.tokenBudget });
  return normalizePerks(raw, results);
}
