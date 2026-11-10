import type { JobPosting, SalaryEstimate } from "../types.ts";
import * as llm from "./llm.ts";
import * as normalize from "./normalize.ts";
const { tokenBudget } = normalize;

type Period = SalaryEstimate["period"];
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const preferredDomains = ["levels.fyi", "glassdoor", "payscale", "indeed", "builtin", "ambitionbox"];

// ---------- posted salary text ----------

const currencyHints: [RegExp, string][] = [
  [/\b(USD|EUR|GBP|INR|CAD|AUD|SGD|AED|CHF|JPY|NZD)\b/i, ""],
  [/₹|\brs\.?\s?\d|\blpa\b|\blakhs?\b|\blacs?\b|\bcrores?\b/i, "INR"],
  [/C\$|CA\$/, "CAD"],
  [/A\$|AU\$/, "AUD"],
  [/£/, "GBP"],
  [/€/, "EUR"],
  [/\$/, "USD"],
];

function detectCurrency(text: string): string {
  for (const [pattern, code] of currencyHints) {
    const hit = text.match(pattern);
    if (hit) return code || hit[1]!.toUpperCase();
  }
  return "";
}

function detectPeriod(text: string): Period {
  if (/(\/|\bper\b|\ban?\b)\s?(hr|hour)\b|\bhourly\b/i.test(text)) return "hour";
  if (/(\/|\bper\b|\ban?\b)\s?(mo|month)\b|\bmonthly\b/i.test(text)) return "month";
  if (/(\/|\bper\b|\ban?\b)\s?(yr|year)\b|\bannual|\byearly\b|\blpa\b|\bp\.?a\.?\b/i.test(text)) return "year";
  return "";
}

const multipliers: Record<string, number> = { k: 1e3, m: 1e6, l: 1e5, lpa: 1e5, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, cr: 1e7, crore: 1e7, crores: 1e7 };

function amounts(text: string): number[] {
  const found: { value: number; suffix: string }[] = [];
  for (const match of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|crores?|cr|k|m|l)?(?![\p{L}\p{N}])/giu)) {
    const raw = Number(match[1]!.replace(/,/g, ""));
    if (Number.isFinite(raw)) found.push({ value: raw, suffix: (match[2] ?? "").toLowerCase() });
  }
  // "25-35L": the single suffix applies to both ends
  const shared = found.find((item) => item.suffix)?.suffix ?? "";
  return found.slice(0, 2).map((item) => item.value * (multipliers[item.suffix || shared] ?? 1));
}

/** Parses "$120,000 - $150,000 a year", "₹25L–35L", "USD 120k-150k", "$60/hr". Null when no amount. */
export function parseSalaryText(text: string): SalaryEstimate | null {
  const [min, max = min] = amounts(text);
  if (min === undefined || min < 10) return null;
  const period = detectPeriod(text) || (min < 1000 ? "hour" : "year");
  const currency = detectCurrency(text) || "USD";
  const low = Math.min(min, max ?? min);
  const high = Math.max(min, max ?? min);
  return { min: low, max: high, currency, period, basis: "posted", note: `Posted on the job page: ${text.trim()}`, sources: [] };
}

// ---------- location → currency ----------

const currencyByLocation: [RegExp, string][] = [
  [/india|bengaluru|bangalore|mumbai|delhi|hyderabad|pune|chennai|gurgaon|gurugram|noida|kolkata|ahmedabad/i, "INR"],
  [/united kingdom|\buk\b|london|england|scotland|manchester/i, "GBP"],
  [/germany|france|spain|italy|netherlands|ireland|berlin|paris|amsterdam|dublin|madrid|europe/i, "EUR"],
  [/canada|toronto|vancouver|montreal/i, "CAD"],
  [/australia|sydney|melbourne/i, "AUD"],
  [/singapore/i, "SGD"],
  [/dubai|uae|abu dhabi|emirates/i, "AED"],
  [/switzerland|zurich/i, "CHF"],
];

export function currencyForLocation(location: string): string {
  return currencyByLocation.find(([pattern]) => pattern.test(location))?.[1] ?? "USD";
}

// ---------- DuckDuckGo HTML ----------

export function searchUrl(job: JobPosting): string {
  const query = `${job.title} ${job.company} salary ${job.location}`.replace(/\s+/g, " ").trim();
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") return String.fromCodePoint(code[1]!.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return named[code.toLowerCase()] ?? whole;
  });
}

function toPlainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function resolveResultUrl(href: string): string {
  const decoded = decodeEntities(href);
  const redirect = decoded.match(/[?&]uddg=([^&]+)/);
  if (redirect) return decodeURIComponent(redirect[1]!);
  return decoded.startsWith("//") ? `https:${decoded}` : decoded;
}

/** Regex based so it runs in the panel, bun test and workers alike. Sponsored results are skipped. */
export function parseSearchResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const blocks = html.split(/(?=<a\b[^>]*class="[^"]*\bresult__a\b)/).slice(1);
  for (const block of blocks) {
    const link = block.match(/^<a\b([^>]*)>([\s\S]*?)<\/a>/);
    const href = link?.[1]?.match(/href="([^"]*)"/)?.[1];
    if (!link || !href) continue;
    const url = resolveResultUrl(href);
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue;
    const snippet = block.match(/class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/)?.[1] ?? "";
    results.push({ title: toPlainText(link[2]!), url, snippet: toPlainText(snippet) });
  }
  return results;
}

function domainRank(url: string): number {
  const index = preferredDomains.findIndex((domain) => url.includes(domain));
  return index < 0 ? preferredDomains.length : index;
}

const salaryWords = /salar|compensation|pay\b|\bctc\b|\blpa\b|per (year|annum|month|hour)|[$₹£€]\s?\d/i;

export function pickResults(results: SearchResult[], limit = 8): SearchResult[] {
  return results
    .filter((result) => salaryWords.test(`${result.title} ${result.snippet}`))
    .map((result, order) => ({ result, order }))
    .sort((a, b) => domainRank(a.result.url) - domainRank(b.result.url) || a.order - b.order)
    .slice(0, limit)
    .map((item) => item.result);
}

// ---------- Bing HTML ----------

export function bingSearchUrl(job: JobPosting): string {
  const query = `${job.title} ${job.company} salary ${job.location}`.replace(/\s+/g, " ").trim();
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`;
}

/** Bing wraps links as bing.com/ck/a?...&u=a1<base64url of target>. */
function resolveBingUrl(href: string): string {
  const decoded = decodeEntities(href);
  const encoded = decoded.match(/[?&]u=a1([^&]+)/)?.[1];
  if (!encoded) return decoded;
  try {
    return atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return decoded;
  }
}

export function parseBingResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const block of html.split(/<li class="b_algo"/).slice(1)) {
    const link = block.match(/<h2[^>]*>\s*<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const url = resolveBingUrl(link[1]!);
    if (!/^https?:\/\//.test(url)) continue;
    const snippet = block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
    results.push({ title: toPlainText(link[2]!), url, snippet: toPlainText(snippet) });
  }
  return results;
}

async function fetchResults(url: string, parse: (html: string) => SearchResult[], fetchPage: typeof fetch): Promise<SearchResult[]> {
  try {
    const response = await fetchPage(url, { headers: { accept: "text/html" } });
    if (!response.ok) return [];
    return parse(await response.text());
  } catch {
    return [];
  }
}

/** Bing first: DuckDuckGo's HTML endpoint often answers automated requests with a captcha page. */
export async function searchWeb(job: JobPosting, fetchPage: typeof fetch = fetch): Promise<SearchResult[]> {
  const bing = await fetchResults(bingSearchUrl(job), parseBingResults, fetchPage);
  if (bing.length) return pickResults(bing);
  return pickResults(await fetchResults(searchUrl(job), parseSearchResults, fetchPage));
}

// ---------- LLM extraction ----------

const extractionSystem = `Read the search snippets and report the salary range for the job. Reply with JSON only:
{"min": 2500000, "max": 3800000, "currency": "INR", "period": "year", "note": "which role/company the figures are for", "sourceUrls": ["https://..."]}
- Copy figures from the snippets; never invent numbers. Full numbers (150000, not 150k).
- Prefer the exact title and company. If only a nearby role is available (same title at a similar company, or another level at the same company), use it and say so in "note".
- If no snippet has a salary figure, use null for min and max.
Be brief; do not deliberate.`;

export function buildExtractionPrompt(job: JobPosting, results: SearchResult[], currency: string): string {
  const snippets = results.map((result, index) => `[${index + 1}] ${result.title}\n${result.url}\n${normalize.truncate(result.snippet, 350)}`);
  return `Job: ${job.title} at ${job.company}, ${job.location || "location unknown"}. Expected currency: ${currency}.\n\nSearch results:\n${snippets.join("\n\n")}`;
}

export function normalizeExtraction(raw: unknown, results: SearchResult[], location: string): SalaryEstimate | null {
  const data = normalize.asRecord(raw);
  const min = normalize.asNumber(data.min);
  const max = normalize.asNumber(data.max);
  if (min === null && max === null) return null;
  const low = Math.min(min ?? max!, max ?? min!);
  const high = Math.max(min ?? max!, max ?? min!);
  if (low <= 0) return null;
  const cited = new Set(normalize.asStringList(data.sourceUrls, 10));
  const used = results.filter((result) => cited.has(result.url));
  const currency = /^[A-Za-z]{3}$/.test(normalize.asString(data.currency)) ? normalize.asString(data.currency).toUpperCase() : currencyForLocation(location);
  const period = normalizePeriod(data.period);
  return {
    min: fixMagnitude(low, currency, period),
    max: fixMagnitude(high, currency, period),
    currency,
    period,
    basis: "web",
    note: normalize.asString(data.note) || "Extracted from web search results.",
    sources: (used.length ? used : results.slice(0, 3)).map(({ title, url }) => ({ title, url })),
  };
}

/** Small models often answer "25" meaning 25 LPA or "150" meaning 150k. */
export function fixMagnitude(value: number | null, currency: string, period: Period): number | null {
  if (value === null || period !== "year" || value >= 1000) return value;
  return value * (currency === "INR" ? 1e5 : 1e3);
}

function normalizePeriod(value: unknown): Period {
  const text = normalize.asString(value).toLowerCase();
  if (/hour|hr/.test(text)) return "hour";
  if (/month|mo/.test(text)) return "month";
  return "year";
}

const estimateSystem = `You estimate market salary for a job when no posted figure exists. Reply with JSON:
{"min": number, "max": number, "currency": string, "period": "year"|"month"|"hour", "note": string}
Base it on title, seniority, company type/size, location and required skills. Full numbers (150000, not 150k). The note states the assumptions in one or two sentences, including which comparable role or company you used. This is an estimate, not a fact.
Sanity scale for annual pay: India (INR) roles usually 300000-15000000 (3-150 lakh); US tech roles usually 60000-500000 USD.`;

export function normalizeEstimate(raw: unknown, location: string): SalaryEstimate {
  const data = normalize.asRecord(raw);
  const a = normalize.asNumber(data.min);
  const b = normalize.asNumber(data.max);
  const known = [a, b].filter((value): value is number => value !== null && value > 0);
  const stated = normalize.asString(data.currency).toUpperCase();
  const currency = /^[A-Z]{3}$/.test(stated) ? stated : currencyForLocation(location);
  const period = normalizePeriod(data.period);
  return {
    min: fixMagnitude(known.length ? Math.min(...known) : null, currency, period),
    max: fixMagnitude(known.length ? Math.max(...known) : null, currency, period),
    currency,
    period,
    basis: "estimate",
    note: normalize.asString(data.note) || "Rough estimate from the title, company and location.",
    sources: [],
  };
}

export function referenceLinks(job: JobPosting): { title: string; url: string }[] {
  const slug = job.company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const keyword = encodeURIComponent(`${job.title} ${job.company}`.trim());
  return [
    { title: "Levels.fyi", url: slug ? `https://www.levels.fyi/companies/${slug}/salaries` : "https://www.levels.fyi/" },
    { title: "Glassdoor salary search", url: `https://www.glassdoor.com/Search/results.htm?keyword=${keyword}` },
  ];
}

async function extractFromWeb(client: llm.LlmClient, job: JobPosting, results: SearchResult[]): Promise<SalaryEstimate | null> {
  if (!results.length) return null;
  try {
    // one attempt, not chatJson: a retry doubles a slow call and the LLM-only estimate is the fallback anyway
    const reply = await client.chat({
      system: `${extractionSystem}`,
      user: buildExtractionPrompt(job, results, currencyForLocation(job.location)),
      maxTokens: tokenBudget,
      json: true,
    });
    return normalizeExtraction(llm.parseJson(reply), results, job.location);
  } catch {
    return null;
  }
}

async function estimateWithModel(client: llm.LlmClient, job: JobPosting): Promise<SalaryEstimate> {
  const user = `Job: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location}\nDescription:\n${normalize.truncate(job.description, 3000)}`;
  const raw = await llm.chatJson<unknown>(client, { system: estimateSystem, user, maxTokens: tokenBudget });
  return normalizeEstimate(raw, job.location);
}

export async function estimate(client: llm.LlmClient, job: JobPosting, options: { webSearch: boolean }, fetchPage: typeof fetch = fetch): Promise<SalaryEstimate> {
  const links = referenceLinks(job);
  const posted = parseSalaryText(job.salaryText);
  if (posted) return { ...posted, sources: links };
  if (options.webSearch) {
    const results = await searchWeb(job, fetchPage);
    const web = await extractFromWeb(client, job, results);
    if (web) return { ...web, sources: [...web.sources, ...links] };
  }
  const guess = await estimateWithModel(client, job);
  return { ...guess, sources: links };
}
