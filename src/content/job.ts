import type { JobPosting } from "../types.ts";
import * as sites from "./jobSites.ts";

const MAX_DESCRIPTION = 12000;
const JOB_WORDS = [/responsibilit/i, /requirement/i, /qualification/i, /experience/i, /skills/i, /benefits/i];

/** Extract the job posting visible in this frame, or null. */
export function extract(doc: Document = document, href: string = location.href): JobPosting | null {
  const structured = fromJsonLd(doc);
  const site = sites.detect(doc, href);
  const found = structured || site ? merge(structured, site) : fromGeneric(doc);
  if (!found?.title) return null;
  return finish(found, site, doc, href);
}

type Fields = Omit<JobPosting, "id" | "url">;

function merge(structured: Fields | null, site: sites.SiteJob | null): Fields {
  const pick = (field: keyof sites.SiteJob & keyof Fields) => structured?.[field] || site?.[field] || "";
  return {
    title: pick("title"),
    company: pick("company"),
    location: pick("location"),
    description: pick("description"),
    salaryText: pick("salaryText"),
    employmentType: structured?.employmentType ?? "",
    source: site?.source ?? "jsonld",
  };
}

function finish(found: Fields, site: sites.SiteJob | null, doc: Document, href: string): JobPosting {
  const url = new URL(href);
  const description = found.description.slice(0, MAX_DESCRIPTION);
  return {
    ...found,
    company: cleanCompany(found.company || meta(doc, "og:site_name") || (site?.source === "lever" ? (doc.title.split(" - ")[0] ?? "").trim() : "") || companyFromBoardUrl(url)),
    description,
    salaryText: found.salaryText || sites.findSalary(description),
    id: site?.id || sites.urlId(url),
    url: href,
  };
}

/** Workday JSON-LD often carries a legal-entity code, e.g. "2100 NVIDIA USA". */
function cleanCompany(company: string): string {
  return company.replace(/^\d+\s+/, "").trim();
}

/** job-boards.greenhouse.io/<slug>/jobs/..., jobs.lever.co/<slug>/..., jobs.ashbyhq.com/<slug>/... */
function companyFromBoardUrl(url: URL): string {
  if (!/greenhouse\.io|lever\.co|ashbyhq\.com/.test(url.hostname)) return "";
  const slug = url.pathname.split("/").filter(Boolean)[0] ?? "";
  if (!slug || slug === "embed") return "";
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function meta(doc: Document, property: string): string {
  const element = doc.querySelector(`meta[property="${property}"], meta[name="${property}"]`);
  return element?.getAttribute("content")?.trim() ?? "";
}

// ---- JSON-LD ----

function fromJsonLd(doc: Document): Fields | null {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    const posting = findPosting(parseJson(script.textContent ?? ""));
    if (posting) return readPosting(posting);
  }
  return null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

type Json = Record<string, any>;

function findPosting(node: unknown): Json | null {
  if (Array.isArray(node)) return node.map(findPosting).find(Boolean) ?? null;
  if (!node || typeof node !== "object") return null;
  const record = node as Json;
  const types = [record["@type"]].flat();
  if (types.includes("JobPosting")) return record;
  return findPosting(record["@graph"]);
}

function readPosting(posting: Json): Fields {
  return {
    title: htmlToText(String(posting.title ?? posting.name ?? "")).replace(/\n+/g, " "),
    company: nameOf(posting.hiringOrganization),
    location: locationOf(posting),
    description: htmlToText(String(posting.description ?? "")),
    salaryText: salaryOf(posting.baseSalary),
    employmentType: [posting.employmentType ?? []].flat().join(", "),
    source: "jsonld",
  };
}

/** Parsed in a separate inert document so images and inline handlers in the listing never load or run. */
function htmlToText(html: string): string {
  const parse = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body;
  let holder = parse(html);
  // some boards double-escape the HTML ("&lt;p&gt;")
  if (!holder.children.length && /<\w+/.test(holder.textContent ?? "")) holder = parse(holder.textContent ?? "");
  return sites.toText(holder);
}

function nameOf(value: unknown): string {
  if (typeof value === "string") return value;
  return String((value as Json | undefined)?.name ?? "");
}

function locationOf(posting: Json): string {
  const places = [posting.jobLocation ?? []].flat().map((place: Json) => {
    const address = place?.address;
    if (typeof address === "string") return address;
    return [address?.addressLocality, address?.addressRegion, nameOf(address?.addressCountry)].filter(Boolean).join(", ");
  });
  const remote = posting.jobLocationType === "TELECOMMUTE" ? ["Remote"] : [];
  return [...places.filter(Boolean), ...remote].join(" / ");
}

function salaryOf(salary: Json | undefined): string {
  const value = salary?.value;
  if (!value || typeof value !== "object") return "";
  const min = value.minValue ?? value.value;
  const max = value.maxValue;
  if (min == null) return "";
  const amount = (n: number) => Number(n).toLocaleString("en-US");
  const range = max != null && max !== min ? `${amount(min)}–${amount(max)}` : amount(min);
  const unit = value.unitText ? ` / ${String(value.unitText).toLowerCase()}` : "";
  return `${salary?.currency ?? ""} ${range}${unit}`.trim();
}

// ---- generic fallback ----

function fromGeneric(doc: Document): Fields | null {
  const title = doc.querySelector("h1")?.textContent?.trim() || meta(doc, "og:title");
  const container = doc.querySelector("main, article, [role=main]") ?? doc.body;
  if (!title || !container) return null;
  const description = sites.toText(container);
  const wordHits = JOB_WORDS.filter((word) => word.test(description)).length;
  if (description.length < 600 || wordHits < 2) return null;
  return {
    title,
    company: meta(doc, "og:site_name") || titleSuffix(doc.title),
    location: "",
    description,
    salaryText: "",
    employmentType: "",
    source: "generic",
  };
}

function titleSuffix(pageTitle: string): string {
  const parts = pageTitle.split(/\s[|\-–]\s/);
  return parts.length > 1 ? (parts.at(-1) ?? "").trim() : "";
}

// ---- change watching ----

/** Broadcast { type: "jobChanged" } when an in-page job switch happens without a URL change. */
export function watchForChanges(): void {
  if (window !== window.top) return;
  let last = sites.signature(document, location.href);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    timer = undefined;
    const now = sites.signature(document, location.href);
    if (now === last) return;
    last = now;
    try {
      chrome.runtime.sendMessage({ type: "jobChanged", url: location.href })?.catch?.(() => {});
    } catch {
      // extension context gone (reloaded) or no listener
    }
  };
  // throttle: at most one signature comparison per 600 ms, however noisy the DOM
  new MutationObserver(() => {
    timer ??= setTimeout(check, 600);
  }).observe(document.body ?? document.documentElement, { childList: true, subtree: true, characterData: true });
}
