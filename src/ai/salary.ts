import type { JobPosting, SalaryComponents, SalaryEstimate, SalaryRange } from "../types.ts";
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

const multipliers: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, l: 1e5, lpa: 1e5, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, cr: 1e7, crore: 1e7, crores: 1e7 };

function amounts(text: string): number[] {
  const found: { value: number; suffix: string }[] = [];
  for (const match of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|crores?|cr|thousand|million|mn|k|m|l)?(?![\p{L}\p{N}])/giu)) {
    const raw = Number(match[1]!.replace(/,/g, ""));
    if (Number.isFinite(raw)) found.push({ value: raw, suffix: (match[2] ?? "").toLowerCase() });
  }
  // "25-35L": the single suffix applies to both ends
  const shared = found.find((item) => item.suffix)?.suffix ?? "";
  return found.slice(0, 2).map((item) => item.value * (multipliers[item.suffix || shared] ?? 1));
}

// ---------- pay components (base / bonus / stock per year) ----------

const defaultVestingYears = 4;

function toBounds(value: unknown): number[] {
  if (Array.isArray(value)) return value.flatMap(toBounds);
  if (value && typeof value === "object") return [normalize.asRecord(value).min, normalize.asRecord(value).max].flatMap(toBounds);
  const plain = normalize.asNumber(value);
  if (plain !== null) return [plain];
  return typeof value === "string" && !value.includes("%") ? amounts(value) : [];
}

/** Tolerant: 150000, "$180k", "₹45L", "2.5 Cr", "45L - 60L", [a, b], {min, max}. Null when no positive amount. */
export function toRange(value: unknown): SalaryRange | null {
  const bounds = toBounds(value).filter((amount) => amount > 0);
  if (!bounds.length) return null;
  return { min: Math.min(...bounds), max: Math.max(...bounds) };
}

function mapRange(range: SalaryRange | null, convert: (amount: number) => number): SalaryRange | null {
  return range && { min: convert(range.min), max: convert(range.max) };
}

function yearlyRange(value: unknown, currency: string, period: Period): SalaryRange | null {
  const monthsFactor = period === "month" ? 12 : 1;
  return mapRange(toRange(value), (amount) => fixMagnitude(amount * monthsFactor, currency, "year")!);
}

function vestingYears(value: unknown): number {
  const years = toRange(value)?.min ?? defaultVestingYears;
  return years >= 1 && years <= 10 ? years : defaultVestingYears;
}

function annualise(grant: SalaryRange | null, years: number): SalaryRange | null {
  return mapRange(grant, (amount) => Math.round(amount / years));
}

function grantNote(years: number): string {
  return `Stock counted per year: grant ÷ ${years} years of vesting.`;
}

type Parts = Pick<SalaryComponents, "base" | "bonus" | "stock">;

/** Total is the stated one when it covers the parts, else their sum; one lone part without a stated total is just the plain range. */
export function assembleComponents(parts: Parts, statedTotal: SalaryRange | null): SalaryComponents | null {
  const known = Object.values(parts).filter((range): range is SalaryRange => range !== null);
  if (!known.length) return null;
  const sum = { min: known.reduce((all, range) => all + range.min, 0), max: known.reduce((all, range) => all + range.max, 0) };
  const isStatedUsable = statedTotal !== null && statedTotal.max >= sum.max;
  const total = isStatedUsable ? statedTotal : known.length >= 2 ? sum : null;
  return total && { ...parts, total };
}

function applyComponents(estimate: SalaryEstimate, components: SalaryComponents | null, extraNote: string): SalaryEstimate {
  if (!components) return estimate;
  const note = [estimate.note, extraNote].filter(Boolean).join(" ");
  return { ...estimate, min: components.total.min, max: components.total.max, period: "year", components, note };
}

function withModelComponents(estimate: SalaryEstimate, data: Record<string, unknown>): SalaryEstimate {
  if (estimate.period === "hour") return estimate;
  const { currency, period } = estimate;
  const perYear = yearlyRange(data.stock, currency, period);
  const years = vestingYears(data.vestingYears);
  const grant = perYear ? null : yearlyRange(data.stockGrant, currency, "year");
  const parts = { base: yearlyRange(data.base, currency, period), bonus: yearlyRange(data.bonus, currency, period), stock: perYear ?? annualise(grant, years) };
  return applyComponents(estimate, assembleComponents(parts, yearlyRange(data.total, currency, period)), grant ? grantNote(years) : "");
}

// ---------- bonus / equity next to a posted salary ----------

const amountPattern = "(?:(?:[$₹£€]|\\brs\\.?\\s?)\\s?\\d[\\d,]*(?:\\.\\d+)?\\s?(?:lpa|lakhs?|lacs?|crores?|cr|million|mn|k|m|l)?|\\d[\\d,]*(?:\\.\\d+)?\\s?(?:lpa|lakhs?|lacs?|crores?|cr|million|mn|k|m|l))(?![\\p{L}\\p{N}])";
const percentPattern = "(\\d{1,3}(?:\\.\\d+)?)\\s?%";
const fillerWords = "(?:(?:annual|yearly|target|performance|cash|in|of|worth)\\s+){0,2}";
const vestingTail = "(?:\\s*(?:vesting\\s+|vested\\s+)?over\\s+(\\d{1,2})\\s*(?:years?|yrs?))?";
const stockWords = "(?:equity|rsus?|stock(?:\\s+options)?|esops?)";

function patternsFor(keyword: string, tail: string): RegExp[] {
  return [`(${amountPattern})\\s*${fillerWords}${keyword}${tail}`, `${keyword}\\s*(?:of|:|-|up to|worth)?\\s*(${amountPattern})${tail}`].map((source) => new RegExp(source, "iu"));
}

const stockPatterns = patternsFor(stockWords, vestingTail);
const bonusAmountPatterns = patternsFor("bonus", "");
const bonusPercentPatterns = [`${percentPattern}\\s*(?:(?:annual|yearly|target|performance)\\s+)?bonus`, `bonus\\s*(?:of|:|target)?\\s*${percentPattern}`].map((source) => new RegExp(source, "i"));

interface TakenExtra {
  figure: string;
  years: string | undefined;
}

function takeExtra(text: string, patterns: RegExp[]): { rest: string; taken: TakenExtra } | null {
  for (const pattern of patterns) {
    const hit = text.match(pattern);
    if (hit) return { rest: text.replace(hit[0], " "), taken: { figure: hit[1]!, years: hit[2] } };
  }
  return null;
}

interface PostedExtras {
  rest: string;
  stock: TakenExtra | null;
  bonus: TakenExtra | null;
  bonusPercent: TakenExtra | null;
}

/** Pulls "plus $20k bonus", "15% bonus", "RSUs worth $200k over 4 years" out so they do not read as part of the base range. */
function splitExtras(text: string): PostedExtras {
  let rest = text;
  const take = (patterns: RegExp[]): TakenExtra | null => {
    const found = takeExtra(rest, patterns);
    if (found) rest = found.rest;
    return found?.taken ?? null;
  };
  const stock = take(stockPatterns);
  const bonus = take(bonusAmountPatterns);
  const bonusPercent = bonus ? null : take(bonusPercentPatterns);
  return { rest, stock, bonus, bonusPercent };
}

function withPostedExtras(posted: SalaryEstimate, extras: PostedExtras): SalaryEstimate {
  if (posted.period === "hour" || posted.min === null || posted.max === null) return posted;
  const monthsFactor = posted.period === "month" ? 12 : 1;
  const base = { min: posted.min * monthsFactor, max: posted.max * monthsFactor };
  const percent = extras.bonusPercent ? Number(extras.bonusPercent.figure) / 100 : 0;
  const bonus = extras.bonus ? toRange(extras.bonus.figure) : mapRange(percent ? base : null, (amount) => Math.round(amount * percent));
  const years = vestingYears(extras.stock?.years);
  const stock = annualise(extras.stock ? toRange(extras.stock.figure) : null, years);
  return applyComponents(posted, assembleComponents({ base, bonus, stock }, null), stock ? grantNote(years) : "");
}

/** Parses "$120,000 - $150,000 a year", "₹25L–35L", "USD 120k-150k", "$60/hr", plus a stated bonus or equity figure. Null when no amount. */
export function parseSalaryText(text: string): SalaryEstimate | null {
  const extras = splitExtras(text);
  const posted = parseBaseSalary(text, extras.rest);
  return posted && withPostedExtras(posted, extras);
}

function parseBaseSalary(text: string, baseText: string): SalaryEstimate | null {
  const [min, max = min] = amounts(baseText);
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

export async function fetchResults(url: string, parse: (html: string) => SearchResult[], fetchPage: typeof fetch): Promise<SearchResult[]> {
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

const extractionSystem = `Read the search snippets and report the pay for the job. Reply with JSON only:
{"min": 2500000, "max": 3800000, "currency": "INR", "period": "year", "base": {"min": 2000000, "max": 2800000}, "bonus": null, "stock": {"min": 500000, "max": 1000000}, "stockGrant": null, "vestingYears": null, "total": {"min": 2500000, "max": 3800000}, "note": "which role/company the figures are for", "sourceIds": [1, 3]}
- Copy figures from the snippets; never invent numbers or a split the snippets do not show. Full numbers (150000, not 150k).
- min/max: the overall range (total pay when the snippets give it, else the one range they show).
- base, bonus (cash, yearly target), stock (value vested per year; levels.fyi lists it as "Stock (/yr)") and total are per YEAR (convert monthly figures). Use null for any part the snippets do not give.
- If a snippet gives only the whole equity grant, put it in stockGrant and the vesting length in vestingYears (4 if unstated); do not divide it yourself.
- If only total pay is known, fill min/max and total and leave base, bonus and stock null.
- Prefer the exact title and company. If only a nearby role is available (same title at a similar company, or another level at the same company), use it and say so in "note".
- sourceIds are the [numbers] of the snippets whose figures you used; list only those.
- If no snippet has a salary figure, use null for min and max.
Be brief; do not deliberate.`;

export function buildExtractionPrompt(job: JobPosting, results: SearchResult[], currency: string): string {
  const snippets = results.map((result, index) => `[${index + 1}] ${result.title}\n${result.url}\n${normalize.truncate(result.snippet, 350)}`);
  return `Job: ${job.title} at ${job.company}, ${job.location || "location unknown"}. Expected currency: ${currency}.\n\nSearch results:\n${snippets.join("\n\n")}`;
}

const figurePattern = /[$₹£€]\s?\d|\d\s?(lpa|lakhs?|k\b)|\d{2,3},\d{3}/i;

function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

/** The result pages the numbers came from: cited by number or URL, else the results whose snippets show a figure. */
export function citedResults(data: Record<string, unknown>, results: SearchResult[]): SearchResult[] {
  const ids = (Array.isArray(data.sourceIds) ? data.sourceIds : []).map((id) => normalize.asNumber(id)).filter((id): id is number => id !== null);
  const byId = results.filter((_, index) => ids.includes(index + 1));
  const urls = new Set(normalize.asStringList(data.sourceUrls, 10).map(normalizeUrl));
  const byUrl = results.filter((result) => urls.has(normalizeUrl(result.url)));
  const cited = byId.length ? byId : byUrl;
  return (cited.length ? cited : results.filter((result) => figurePattern.test(result.snippet))).slice(0, 4);
}

function currencyOf(data: Record<string, unknown>, location: string): string {
  const stated = normalize.asString(data.currency).toUpperCase();
  return /^[A-Z]{3}$/.test(stated) ? stated : currencyForLocation(location);
}

/** The headline range is min/max, else the stated total; the components then override it with the per-year total. */
function fromModel(data: Record<string, unknown>, fields: Pick<SalaryEstimate, "basis" | "currency" | "note" | "sources">): SalaryEstimate {
  const period = normalizePeriod(data.period);
  const headline = toRange([data.min, data.max]) ?? toRange(data.total);
  const min = fixMagnitude(headline?.min ?? null, fields.currency, period);
  const max = fixMagnitude(headline?.max ?? null, fields.currency, period);
  return withModelComponents({ min, max, period, ...fields }, data);
}

export function normalizeExtraction(raw: unknown, results: SearchResult[], location: string): SalaryEstimate | null {
  const data = normalize.asRecord(raw);
  const fields = { basis: "web" as const, currency: currencyOf(data, location), note: normalize.asString(data.note) || "Extracted from web search results.", sources: citedResults(data, results).map(({ title, url }) => ({ title, url })) };
  const estimate = fromModel(data, fields);
  return estimate.min === null && estimate.max === null ? null : estimate;
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

const estimateSystem = `You estimate market pay for a job when no posted figure exists. Reply with JSON:
{"min": number, "max": number, "currency": string, "period": "year", "base": {"min": number, "max": number} | null, "bonus": {"min": number, "max": number} | null, "stock": {"min": number, "max": number} | null, "total": {"min": number, "max": number} | null, "note": string}
Base it on title, seniority, company type/size, location and required skills. Full numbers (150000, not 150k). The note states the assumptions in one or two sentences, including which comparable role or company you used. This is an estimate, not a fact.
Pay parts, all per YEAR: base salary; bonus = cash, yearly target; stock = RSUs/options value vested per year (a 4-year grant counts as grant / 4). Give a part when this kind of company usually pays it (big tech and public companies grant RSUs and a cash bonus; many startups give options of unclear value: null). Use null for a part you have no basis for; never pad a split. total = base + bonus + stock; min/max = total. If you only know overall pay, fill min/max and leave the parts null. Say in the note which parts are assumed from the company type.
Sanity scale for annual pay: India (INR) roles usually 300000-15000000 (3-150 lakh) base; US tech roles usually 60000-500000 USD base.`;

export function normalizeEstimate(raw: unknown, location: string): SalaryEstimate {
  const data = normalize.asRecord(raw);
  const note = normalize.asString(data.note) || "Rough estimate from the title, company and location.";
  return fromModel(data, { basis: "estimate", currency: currencyOf(data, location), note, sources: [] });
}

// ---------- look-up links (not data sources) ----------

export const lookupPrefix = "Look up: ";

export function isLookup(source: { title: string }): boolean {
  return source.title.startsWith(lookupPrefix);
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const levelsRoles: [RegExp, string][] = [
  [/engineering manager|head of engineering|director of engineering|vp of engineering|vp engineering/i, "software-engineering-manager"],
  [/technical program manager|\btpm\b/i, "technical-program-manager"],
  [/product manager|\bpm\b|product owner/i, "product-manager"],
  [/data scientist/i, "data-scientist"],
  [/designer|\bux\b/i, "product-designer"],
  [/engineer|developer|\bsde\b|\bswe\b|programmer|architect/i, "software-engineer"],
];

function levelsRole(title: string): string {
  return levelsRoles.find(([pattern]) => pattern.test(title))?.[1] ?? "";
}

export function levelsUrl(job: JobPosting): string {
  const role = levelsRole(job.title);
  const company = slugify(job.company);
  if (company) return `https://www.levels.fyi/companies/${company}/salaries${role ? `/${role}` : ""}`;
  return role ? `https://www.levels.fyi/t/${role}` : "https://www.levels.fyi/";
}

const glassdoorDomains: Record<string, string> = { INR: "co.in", GBP: "co.uk", CAD: "ca", AUD: "com.au" };

/** Glassdoor's salary search URL embeds the keyword length; the country domain narrows results to the job's market. */
export function glassdoorUrl(job: JobPosting): string {
  const keyword = `${job.company} ${job.title}`.replace(/\([^)]*\)/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 80);
  const domain = glassdoorDomains[currencyForLocation(job.location)] ?? "com";
  return `https://www.glassdoor.${domain}/Salaries/${keyword.replace(/ /g, "-")}-salary-SRCH_KO0,${keyword.length}.htm`;
}

/** Company pages are empty for small companies, so the role across the whole market is always offered too. */
export function lookupLinks(job: JobPosting): { title: string; url: string }[] {
  const what = [job.title, job.company && `at ${job.company}`].filter(Boolean).join(" ");
  const companyLinks = [
    { title: `${lookupPrefix}Levels.fyi – ${what}`, url: levelsUrl(job) },
    { title: `${lookupPrefix}Glassdoor – ${what}`, url: glassdoorUrl(job) },
  ];
  if (!job.company) return companyLinks;
  const market = { ...job, company: "" };
  const marketLinks = [
    { title: `${lookupPrefix}Levels.fyi – ${job.title}, all companies`, url: levelsUrl(market) },
    { title: `${lookupPrefix}Glassdoor – ${job.title}, all companies`, url: glassdoorUrl(market) },
  ];
  return [...companyLinks, ...marketLinks];
}

// ---------- Levels.fyi pages (structured data, no search engine) ----------

interface LevelsDistribution {
  name?: string;
  currency?: string;
  percentile25?: string | null;
  median?: string | null;
  percentile75?: string | null;
}

function levelsRange(distribution?: LevelsDistribution): { min: number; max: number } | null {
  const median = Number(distribution?.median);
  if (!distribution || !Number.isFinite(median) || median <= 0) return null;
  return { min: Number(distribution.percentile25) || median, max: Number(distribution.percentile75) || median };
}

/** Levels.fyi role pages carry schema.org pay distributions (total, base, equity, bonus); the typical range is the 25th to 75th percentile. */
export function parseLevelsPage(html: string, job: JobPosting, url: string): SalaryEstimate | null {
  const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)];
  for (const [, body] of blocks) {
    let page: { estimatedSalary?: LevelsDistribution[]; name?: string };
    try {
      page = JSON.parse(body!);
    } catch {
      continue;
    }
    const byName = (name: string) => page.estimatedSalary?.find((entry) => entry.name === name);
    const total = levelsRange(byName("total"));
    if (!total) continue;
    const region = html.match(/compensation in ([^"]+?) at /)?.[1];
    const median = Number(byName("total")!.median).toLocaleString("en-US");
    const note = `Levels.fyi: typical range (25th to 75th percentile) for ${page.name ?? job.title} at ${job.company}${region ? ` in ${region}` : ""}, across all levels; median total ${median}.`;
    const data = { currency: byName("total")!.currency, period: "year", total, base: levelsRange(byName("base")), bonus: levelsRange(byName("bonus")), stock: levelsRange(byName("equity")), note };
    return fromModel(data, { basis: "web", currency: normalize.asString(data.currency).toUpperCase() || "USD", note, sources: [{ title: `Levels.fyi – ${job.title} at ${job.company}`, url }] });
  }
  return null;
}

async function levelsEstimate(job: JobPosting, fetchPage: typeof fetch): Promise<SalaryEstimate | null> {
  // Levels.fyi pages carry US data only
  if (!job.company || currencyForLocation(job.location) !== "USD") return null;
  const url = levelsUrl(job);
  try {
    const response = await fetchPage(url, { headers: { accept: "text/html" } });
    return response.ok ? parseLevelsPage(await response.text(), job, url) : null;
  } catch {
    return null;
  }
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
  const links = lookupLinks(job);
  const posted = parseSalaryText(job.salaryText);
  const postedSource = posted && job.url ? [{ title: "This job posting", url: job.url }] : [];
  if (options.webSearch) {
    // the listing's figure is only the employer's range; market data adds the average, bonus and stock
    const web = (await levelsEstimate(job, fetchPage)) ?? (await extractFromWeb(client, job, await searchWeb(job, fetchPage)));
    if (web) {
      const listed = posted && { min: posted.min, max: posted.max, currency: posted.currency, period: posted.period };
      return { ...web, ...(listed && { posted: listed }), sources: [...postedSource, ...web.sources, ...links] };
    }
  }
  if (posted) return { ...posted, sources: [...postedSource, ...links] };
  const guess = await estimateWithModel(client, job);
  return { ...guess, sources: links };
}
