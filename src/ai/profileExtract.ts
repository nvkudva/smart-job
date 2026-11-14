import * as storage from "../storage.ts";
import type { Education, Experience, Profile } from "../types.ts";
import * as normalize from "./normalize.ts";

export const profileSystem = `You extract a structured profile from resume text. Reply with JSON:
{"firstName","middleName","lastName","email","phone","city","state","country","linkedin","github","portfolio","website","headline","summary","yearsExperience":number,"skills":[string],
"experience":[{"title","company","location","start":"YYYY-MM","end":"YYYY-MM or empty if current","current":boolean,"description":"key bullets joined by newlines"}],
"education":[{"school","degree","field","start":"YYYY-MM","end":"YYYY-MM","gpa"}]}
Rules: middleName is only a middle name written in the resume header, never part of firstName or lastName. copy facts exactly as written in the resume; never invent anything. Use "" or [] when a field is not in the resume. Newest experience first. Skills are short names (e.g. "Python", "Stakeholder management").
- Several roles listed under one company heading are separate experience entries, each with that company. A role without its own dates takes the company's date span.
- A role with no employer (career break, sabbatical, freelance) keeps company "".
- Read the whole resume to the end: education, certifications and links are often last. URLs listed under "Links" belong in linkedin / github / portfolio / website.
- city / state / country: where the candidate lives now (from the header, or the location of the current role).`;

// ---------- deterministic pass ----------

interface ContactDetails {
  email: string;
  phone: string;
  otherPhones: string[];
  linkedin: string;
  github: string;
}

function extractContacts(text: string): ContactDetails {
  const email = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0] ?? "";
  const linkedin = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[\w\-%]+\/?/i)?.[0] ?? "";
  const github = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/(?!orgs\b)[\w-]+/i)?.[0] ?? "";
  const [phone = "", ...otherPhones] = findPhones(text);
  return { email, phone, otherPhones, linkedin: withScheme(linkedin), github: withScheme(github) };
}

/** A resume header often says just "GitHub" or "LinkedIn"; keep only a value that is really a link to that site. */
function profileLink(value: string, site: RegExp): string {
  const url = value.trim().replace(/[.,;]+$/, "");
  return site.test(url) ? withScheme(url) : "";
}

function withScheme(url: string): string {
  return url && !/^https?:\/\//i.test(url) ? `https://${url}` : url;
}

/** Every phone number in the text, first one first, without repeats (same digits written twice). */
function findPhones(text: string): string[] {
  const candidates = text.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,5}[\s.-]?\d{3,7}(?:[\s.-]?\d{2,5})?/g) ?? [];
  const phones = candidates.map((item) => item.trim()).filter((item) => {
    const digits = item.replace(/\D/g, "").length;
    return digits >= 10 && digits <= 13 && !/^\d{4}\s*[-–]\s*\d{4}/.test(item);
  });
  const seenDigits = new Set<string>();
  return phones.filter((item) => {
    const digits = item.replace(/\D/g, "");
    if (seenDigits.has(digits)) return false;
    seenDigits.add(digits);
    return true;
  });
}

function countryCodeOf(phone: string): string {
  return phone.match(/^\+(\d{1,3})[\s.-]/)?.[0].trim().replace(/[\s.-]/g, "") ?? "";
}

// ---------- dates and experience ----------

const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Mar 2021", "03/2021", "2021-03", "2021" → "YYYY-MM"; "" for present/unknown. */
export function normalizeMonth(value: unknown): string {
  const text = normalize.asString(value).toLowerCase();
  const iso = text.match(/^(\d{4})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, "0")}`;
  const year = text.match(/\b(19|20)\d{2}\b/)?.[0];
  if (!year) return "";
  const slash = text.match(/\b(\d{1,2})\s*[/.-]\s*(?:19|20)\d{2}\b/);
  const name = months.findIndex((month) => text.includes(month));
  const month = slash ? Number(slash[1]) : name >= 0 ? name + 1 : 1;
  return `${year}-${String(normalize.clamp(month, 1, 12)).padStart(2, "0")}`;
}

function normalizeExperience(raw: unknown): Experience | null {
  const data = normalize.asRecord(raw);
  const title = normalize.asString(data.title);
  const company = normalize.asString(data.company);
  if (!title && !company) return null;
  const endText = normalize.asString(data.end);
  const current = data.current === true || /present|current|now/i.test(endText);
  return {
    title,
    company,
    location: normalize.asString(data.location),
    start: normalizeMonth(data.start),
    end: current ? "" : normalizeMonth(endText),
    current,
    description: Array.isArray(data.description) ? data.description.map(normalize.asString).join("\n") : normalize.asString(data.description),
  };
}

function normalizeEducation(raw: unknown): Education | null {
  const data = normalize.asRecord(raw);
  const school = normalize.asString(data.school);
  const degree = normalize.asString(data.degree);
  if (!school && !degree) return null;
  return { school, degree, field: normalize.asString(data.field), start: normalizeMonth(data.start), end: normalizeMonth(data.end), gpa: normalize.asString(data.gpa) };
}

function monthIndex(month: string): number {
  const [year, mon] = month.split("-").map(Number);
  return year! * 12 + (mon ?? 1) - 1;
}

/** Years covered by the union of all jobs, so overlapping roles are not double counted. */
export function yearsFromExperience(experience: Experience[], now: Date): number {
  const nowIndex = now.getFullYear() * 12 + now.getMonth();
  const spans = experience
    .filter((job) => job.start)
    .map((job) => [monthIndex(job.start), job.current || !job.end ? nowIndex : monthIndex(job.end)] as const)
    .filter(([from, to]) => to >= from)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let reachedUntil = -Infinity;
  for (const [from, to] of spans) {
    total += Math.max(0, to - Math.max(from, reachedUntil));
    reachedUntil = Math.max(reachedUntil, to);
  }
  return Math.round(total / 12);
}

function latestExperience(experience: Experience[]): Experience | undefined {
  return experience.find((job) => job.current) ?? [...experience].sort((a, b) => b.start.localeCompare(a.start))[0];
}

// ---------- profile ----------

function isBlank(value: unknown): boolean {
  return value === "" || value === 0 || value == null || (Array.isArray(value) && value.length === 0);
}

/** A re-extraction must not wipe what the user typed: blank extracted fields keep the previous value. */
export function mergeInto(previous: Profile, extracted: Profile): Profile {
  const merged = { ...previous };
  for (const key of Object.keys(extracted) as (keyof Profile)[]) {
    if (!isBlank(extracted[key])) (merged as Record<string, unknown>)[key] = extracted[key];
  }
  return merged;
}

export function buildProfile(raw: unknown, resumeText: string, now = new Date()): Profile {
  const data = normalize.asRecord(raw);
  const contacts = extractContacts(resumeText);
  const experience = (Array.isArray(data.experience) ? data.experience : []).map(normalizeExperience).filter((item) => item !== null);
  const education = (Array.isArray(data.education) ? data.education : []).map(normalizeEducation).filter((item) => item !== null);
  const [first, ...rest] = normalize.asString(data.name).split(/\s+/).filter(Boolean);
  const latest = latestExperience(experience);
  const phone = contacts.phone || normalize.asString(data.phone);
  const years = normalize.asNumber(data.yearsExperience);
  return {
    ...structuredClone(storage.emptyProfile),
    firstName: normalize.asString(data.firstName) || first || "",
    middleName: normalize.asString(data.middleName),
    lastName: normalize.asString(data.lastName) || rest.join(" "),
    email: contacts.email || normalize.asString(data.email),
    phone,
    otherPhones: contacts.otherPhones,
    phoneCountryCode: countryCodeOf(phone),
    city: normalize.asString(data.city),
    state: normalize.asString(data.state),
    country: normalize.asString(data.country),
    linkedin: contacts.linkedin || profileLink(normalize.asString(data.linkedin), /linkedin\.com\/./i),
    github: contacts.github || profileLink(normalize.asString(data.github), /github\.com\/./i),
    portfolio: normalize.asString(data.portfolio),
    website: normalize.asString(data.website),
    headline: normalize.asString(data.headline),
    summary: normalize.asString(data.summary),
    currentTitle: latest?.title || normalize.asString(data.currentTitle),
    // on a career break the model tends to answer "Career break"; forms want the most recent employer
    currentCompany: latest?.company || experience.find((job) => job.company)?.company || normalize.asString(data.currentCompany),
    yearsExperience: years && years > 0 ? years : yearsFromExperience(experience, now),
    skills: normalize.asStringList(data.skills, 60),
    experience,
    education,
  };
}
