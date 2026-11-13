import type { Education, Experience, Profile } from "../types.ts";
import * as llm from "./llm.ts";
import * as normalize from "./normalize.ts";
import * as profileExtract from "./profileExtract.ts";

export interface PageText {
  label: string;
  text: string;
}

export const summaryLimit = 2500;
const pageLimit = 6000;
const skillLimit = 80;

export const linkedinSystem = `You read the text of a person's own LinkedIn pages (main profile, experience, education, skills, certifications, recent activity). Reply with JSON:
{"name","headline","summary","city","state","country","github","portfolio","website","yearsExperience":number,"skills":[string],
"experience":[{"title","company","location","start":"YYYY-MM","end":"YYYY-MM or empty if current","current":boolean,"description":"key bullets joined by newlines"}],
"education":[{"school","degree","field","start":"YYYY-MM","end":"YYYY-MM","gpa"}],
"linkedinSummary":"plain text digest, see below"}
Rules: copy facts exactly as written; never invent anything. Use "" or [] when a field is not on the pages. Newest experience first. Ignore navigation text, buttons, ads and people-you-may-know suggestions. "summary" is the About section. Several roles under one company are separate entries.
linkedinSummary: plain text under ${summaryLimit} characters, no markdown, written for someone matching this person to jobs and writing cover letters. Cover what LinkedIn adds beyond a resume: the About section, extra detail on roles, top skills and endorsements, certifications, recommendations highlights, and the interests, themes and opinions in their own recent posts (not other people's posts they merely liked). Refer to the person by name or as "they"; never guess gender. Skip anything that is not on the pages.`;

const noiseLines = new Set(["like", "comment", "repost", "send", "follow", "connect", "message", "more", "show all", "see more", "…see more", "...see more", "endorse", "skip to main content"]);

/** LinkedIn repeats visible text for screen readers; drop blanks, UI words and consecutive duplicates. */
export function cleanPageText(text: string, limit = pageLimit): string {
  const kept: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || noiseLines.has(line.toLowerCase())) continue;
    if (kept.at(-1)?.toLowerCase() === line.toLowerCase()) continue;
    kept.push(line);
  }
  return normalize.truncate(kept.join("\n"), limit);
}

export function buildInput(pages: PageText[]): string {
  const sections = pages.map((page) => ({ label: page.label, text: cleanPageText(page.text) })).filter((section) => section.text);
  return sections.map((section) => `### ${section.label}\n${section.text}`).join("\n\n");
}

/** "https://www.linkedin.com/in/jane-doe/" from any profile URL; "" when there is no /in/<slug>. */
export function profileRoot(url: string): string {
  const slug = url.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1];
  return slug ? `https://www.linkedin.com/in/${slug}/` : "";
}

export function isLoginUrl(url: string): boolean {
  return /linkedin\.com\/(login|authwall|checkpoint|uas\/)/i.test(url);
}

export function build(raw: unknown, profileUrl: string): Profile {
  const base = profileExtract.buildProfile(raw, "");
  const linkedinSummary = normalize.asString(normalize.asRecord(raw).linkedinSummary);
  return { ...base, linkedin: base.linkedin || profileUrl, linkedinSummary: normalize.truncate(linkedinSummary, summaryLimit) };
}

export async function extract(client: llm.LlmClient, pages: PageText[], profileUrl: string): Promise<Profile> {
  const raw = await llm.chatJson<unknown>(client, { system: linkedinSystem, user: buildInput(pages), maxTokens: normalize.tokenBudget });
  return build(raw, profileUrl);
}

// ---------- merge ----------

function isSameName(first: string, second: string): boolean {
  const left = normalize.comparable(first);
  const right = normalize.comparable(second);
  if (left === right) return true;
  return !!left && !!right && (left.includes(right) || right.includes(left));
}

function isSameJob(existing: Experience, candidate: Experience): boolean {
  if (!isSameName(existing.company, candidate.company)) return false;
  return isSameName(existing.title, candidate.title) || (!!existing.start && existing.start === candidate.start);
}

function isSameEducation(existing: Education, candidate: Education): boolean {
  if (!isSameName(existing.school, candidate.school)) return false;
  return !existing.degree || !candidate.degree || isSameName(existing.degree, candidate.degree);
}

function fillBlanks<T extends object>(target: T, source: T, keys: (keyof T)[]): void {
  for (const key of keys) {
    if (!target[key] && source[key]) target[key] = source[key];
  }
}

function byNewest(first: Experience, second: Experience): number {
  return Number(second.current) - Number(first.current) || second.start.localeCompare(first.start);
}

function mergeExperience(current: Experience[], imported: Experience[]): Experience[] {
  const merged = current.map((job) => ({ ...job }));
  let hasAdded = false;
  for (const candidate of imported) {
    const match = merged.find((job) => isSameJob(job, candidate));
    if (match) fillBlanks(match, candidate, ["location", "start", "description"]);
    else {
      merged.push({ ...candidate });
      hasAdded = true;
    }
  }
  return hasAdded ? merged.sort(byNewest) : merged;
}

function mergeEducation(current: Education[], imported: Education[]): Education[] {
  const merged = current.map((item) => ({ ...item }));
  for (const candidate of imported) {
    const match = merged.find((item) => isSameEducation(item, candidate));
    if (match) fillBlanks(match, candidate, ["degree", "field", "start", "end", "gpa"]);
    else merged.push({ ...candidate });
  }
  return merged;
}

/** Existing (resume / user) values win; LinkedIn fills blanks and adds what is missing. linkedinSummary is always refreshed. */
export function merge(current: Profile, imported: Profile): Profile {
  return {
    ...profileExtract.mergeInto(imported, current),
    skills: normalize.dedupe([...current.skills, ...imported.skills]).slice(0, skillLimit),
    experience: mergeExperience(current.experience, imported.experience),
    education: mergeEducation(current.education, imported.education),
    linkedinSummary: imported.linkedinSummary || current.linkedinSummary,
  };
}
