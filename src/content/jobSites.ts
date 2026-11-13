import type { JobPosting } from "../types.ts";

export type SiteJob = Pick<JobPosting, "title" | "company" | "location" | "description" | "salaryText" | "source"> & { id: string };

interface Spec {
  source: string;
  host: RegExp;
  /** DOM marker so saved/proxied copies of the site (and test fixtures) are detected too */
  marker: string;
  title: string[];
  company: string[];
  location: string[];
  description: string[];
  salary: string[];
  id?: (url: URL, doc: Document) => string;
  /** Tried before the selectors, for sites whose markup has no stable class names */
  readLayout?: (doc: Document, url: URL) => SiteJob | null;
  fixup?: (job: SiteJob) => void;
}

const BLOCK = new Set(["p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "section", "article", "header", "footer", "br", "main"]);
const SKIP = new Set(["script", "style", "noscript", "template", "button", "svg"]);

const CURRENCY = String.raw`(?:[$€£₹]|USD|EUR|GBP|INR|CAD|AUD)`;
const AMOUNT = String.raw`\d[\d,.]*\s?(?:[kKmM]|L\b|Cr\b)?`;
const UNIT = String.raw`(?:\s?(?:\/|per|a)\s?(?:hr|hour|year|yr|annum|month|mo|week|day))?`;
const SALARY = new RegExp(
  String.raw`${CURRENCY}\s?${AMOUNT}(?:\s?(?:[-–—]|to)\s?(?:${CURRENCY}\s?)?${AMOUNT})?${UNIT}|\b\d{2,3}[kK]\s?[-–—]\s?\d{2,3}[kK]\b${UNIT}`,
);

/** First salary-looking phrase in the text, or "". */
export function findSalary(text: string): string {
  return text.match(SALARY)?.[0].trim() ?? "";
}

/** Plain text with a line per block/bullet. */
export function toText(root: Node): string {
  const out: string[] = [];
  walk(root, out);
  return out
    .join("")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function walk(node: Node, out: string[]): void {
  if (node.nodeType === 3) {
    out.push((node.textContent ?? "").replace(/\s+/g, " "));
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = (node as Element).tagName.toLowerCase();
  if (SKIP.has(tag)) return;
  const isBlock = BLOCK.has(tag);
  if (isBlock) out.push("\n");
  if (tag === "li") out.push("• ");
  for (const child of Array.from(node.childNodes)) walk(child, out);
  if (isBlock) out.push("\n");
}

function firstText(doc: Document, selectors: string[]): string {
  for (const selector of selectors) {
    const element = doc.querySelector(selector);
    const text = element ? toText(element) : "";
    if (text) return text.replace(/\n+/g, " ");
  }
  return "";
}

function firstBlock(doc: Document, selectors: string[]): string {
  for (const selector of selectors) {
    const element = doc.querySelector(selector);
    const text = element ? toText(element) : "";
    if (text) return text;
  }
  return "";
}

const LINKEDIN_TITLE = [
  ".job-details-jobs-unified-top-card__job-title",
  ".jobs-unified-top-card__job-title",
  ".t-24.job-details-jobs-unified-top-card__job-title",
  ".job-details-jobs-unified-top-card__job-title h1",
  ".top-card-layout__title",
];

function linkedinJobId(url: URL, doc: Document): string {
  const fromUrl = url.searchParams.get("currentJobId") ?? url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/)?.[1];
  if (fromUrl) return fromUrl;
  const active = doc.querySelector("[data-job-id].jobs-search-results-list__list-item--active, [data-job-id].job-card-container--active");
  return (active ?? doc.querySelector(".jobs-search__job-details [data-job-id], [data-job-id]"))?.getAttribute("data-job-id") ?? "";
}

const LINKEDIN_ABOUT_PREFIX = "JobDetails_AboutTheJob_";
const LINKEDIN_COMPANY_LABEL = '[aria-label^="Company, "]';

/** LinkedIn's 2026 UI (/jobs/search-results/, /jobs/view/): hashed class names, so read by element ids, aria-labels and text order. */
function readLinkedinLayout(doc: Document, url: URL): SiteJob | null {
  const jobId = url.searchParams.get("currentJobId") ?? url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/)?.[1];
  // with a job id in the URL, wait for that job's block: falling back to any block would return the previous job mid-render
  const about = jobId ? doc.getElementById(LINKEDIN_ABOUT_PREFIX + jobId) : doc.querySelector(`[id^="${LINKEDIN_ABOUT_PREFIX}"]`);
  if (!about) return null;
  let column = about.parentElement;
  while (column && !column.querySelector(LINKEDIN_COMPANY_LABEL)) column = column.parentElement;
  const companyLabel = column?.querySelector(LINKEDIN_COMPANY_LABEL);
  if (!companyLabel) return null;
  const company = (companyLabel.getAttribute("aria-label") ?? "").replace(/^Company,\s*/, "").replace(/\.$/, "").trim();
  let card: Element | null = companyLabel;
  while (card && !card.textContent?.includes("·")) card = card.parentElement;
  const lines = card ? toText(card).split("\n") : [];
  const titleIndex = lines.findIndex((line) => line !== company);
  const placeLine = lines.find((line, index) => index > titleIndex && line.includes("·")) ?? "";
  const description = toText(about).replace(/^About the job\n/i, "");
  return {
    id: `linkedin:${about.id.slice(LINKEDIN_ABOUT_PREFIX.length)}`,
    source: "linkedin",
    title: lines[titleIndex] ?? "",
    company,
    location: (placeLine.split("·")[0] ?? "").trim(),
    description,
    salaryText: findSalary(lines.join(" ")),
  };
}

const SPECS: Spec[] = [
  {
    source: "linkedin",
    host: /(^|\.)linkedin\.com$/,
    marker: LINKEDIN_TITLE.join(",") + `, .jobs-search__job-details, #job-details, .jobs-description__content, [id^="${LINKEDIN_ABOUT_PREFIX}"]`,
    readLayout: readLinkedinLayout,
    title: LINKEDIN_TITLE,
    company: [
      ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name",
      ".topcard__org-name-link",
    ],
    location: [
      ".job-details-jobs-unified-top-card__primary-description-container",
      ".job-details-jobs-unified-top-card__tertiary-description-container",
      ".jobs-unified-top-card__bullet",
      ".topcard__flavor--bullet",
    ],
    description: ["#job-details", ".jobs-description__content", ".jobs-box__html-content", ".show-more-less-html__markup"],
    salary: [".job-details-preferences-and-skills", ".salary", ".compensation__salary", ".job-details-jobs-unified-top-card__job-insight"],
    id: (url, doc) => {
      const id = linkedinJobId(url, doc);
      return id ? `linkedin:${id}` : "";
    },
    fixup: (job) => {
      // "Berlin, Germany · 2 days ago · 50 applicants": keep the place only
      job.location = (job.location.split("·")[0] ?? "").trim();
    },
  },
  {
    source: "indeed",
    host: /(^|\.)indeed\.[a-z.]+$/,
    marker: "#jobDescriptionText",
    title: ['[data-testid="jobsearch-JobInfoHeader-title"]', "h1.jobsearch-JobInfoHeader-title", "h1"],
    company: ['[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]'],
    location: ['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]'],
    description: ["#jobDescriptionText"],
    salary: ["#salaryInfoAndJobType", '[data-testid="jobsearch-OtherJobDetailsContainer"]', "#salaryGuide"],
    id: (url) => {
      const jk = url.searchParams.get("vjk") ?? url.searchParams.get("jk");
      return jk ? `indeed:${jk}` : "";
    },
    fixup: (job) => {
      job.title = job.title.replace(/\s*-\s*job post$/i, "");
    },
  },
  {
    source: "greenhouse",
    host: /(^|\.)greenhouse\.io$/,
    marker: ".app-title, #grnhse_app, .job__title",
    title: [".app-title", "h1.section-header", ".job__title h1", "h1"],
    company: [".company-name"],
    location: [".location", ".job__location"],
    description: ["#content", ".job__description"],
    salary: [".pay-range", ".job__pay-range"],
    fixup: (job) => {
      job.company = job.company.replace(/^at\s+/i, "");
    },
  },
  {
    source: "lever",
    host: /(^|\.)jobs\.lever\.co$/,
    marker: ".posting-headline",
    title: [".posting-headline h2"],
    company: [],
    location: [".posting-categories .location"],
    description: ['[data-qa="job-description"]', ".section-wrapper .posting-page", ".posting-page"],
    salary: ['[data-qa="salary-range"]', ".posting-categories .compensation"],
  },
  {
    source: "workday",
    host: /(^|\.)myworkdayjobs\.com$/,
    marker: '[data-automation-id="jobPostingHeader"], [data-automation-id="jobPostingDescription"]',
    title: ['[data-automation-id="jobPostingHeader"]'],
    company: [],
    location: ['[data-automation-id="locations"]'],
    description: ['[data-automation-id="jobPostingDescription"]'],
    salary: [],
  },
  {
    source: "icims",
    host: /(^|\.)icims\.com$/,
    marker: ".iCIMS_JobHeaderGroup, .iCIMS_JobContent",
    title: [".iCIMS_JobHeaderGroup h1", ".iCIMS_Header", "h1"],
    company: [],
    location: [".iCIMS_InfoMsg_Job .iCIMS_InfoMsg_Location", ".iCIMS_InfoMsg_Job"],
    description: [".iCIMS_JobContent"],
    salary: [],
    fixup: (job) => {
      job.location = job.location.replace(/^Job Location\s*[:|-]?\s*/i, "");
    },
  },
  {
    source: "ashby",
    host: /(^|\.)jobs\.ashbyhq\.com$/,
    marker: '[class*="ashby-job-posting"]',
    title: ['[class*="ashby-job-posting-heading"]', "h1"],
    company: [],
    location: ['[class*="ashby-job-posting-brief"] [class*="location"]'],
    description: ['[class*="_descriptionText"]', '[class*="ashby-job-posting-right-pane"]', "main"],
    salary: ['[class*="compensation"]'],
  },
  {
    source: "smartrecruiters",
    host: /(^|\.)smartrecruiters\.com$/,
    marker: ".job-sections, .job-title",
    title: ["h1.job-title", "h1"],
    company: [".company-name", '[itemprop="hiringOrganization"]'],
    location: ['[itemprop="jobLocation"]', ".job-location"],
    description: [".job-sections", '[itemprop="description"]'],
    salary: [],
  },
];

/** The first site extractor whose host or markers match this document. */
export function detect(doc: Document, href: string): SiteJob | null {
  const url = new URL(href);
  for (const spec of SPECS) {
    const source = spec.source === "icims" ? icimsDocument(doc) : doc;
    if (!spec.host.test(url.hostname) && !source.querySelector(spec.marker)) continue;
    const job = read(spec, source, url);
    if (job.title) return job;
  }
  return null;
}

function icimsDocument(doc: Document): Document {
  try {
    const frame = doc.querySelector<HTMLIFrameElement>("#icims_content_iframe");
    return frame?.contentDocument ?? doc;
  } catch {
    return doc; // cross-origin frame: its own content script handles it
  }
}

function read(spec: Spec, doc: Document, url: URL): SiteJob {
  const fromLayout = spec.readLayout?.(doc, url);
  if (fromLayout?.title) return fromLayout;
  const job: SiteJob = {
    id: spec.id?.(url, doc) ?? "",
    source: spec.source,
    title: firstText(doc, spec.title),
    company: firstText(doc, spec.company),
    location: firstText(doc, spec.location),
    description: firstBlock(doc, spec.description),
    salaryText: findSalary(firstText(doc, spec.salary)),
  };
  spec.fixup?.(job);
  return job;
}

/** Cheap "which job is showing" string for change detection. */
export function signature(doc: Document, href: string): string {
  const url = new URL(href);
  const title = firstText(doc, [...LINKEDIN_TITLE, "h1"]);
  const linkedinAbout = doc.querySelector(`[id^="${LINKEDIN_ABOUT_PREFIX}"]`)?.id ?? "";
  return `${linkedinJobId(url, doc)}|${title}|${linkedinAbout}`;
}
