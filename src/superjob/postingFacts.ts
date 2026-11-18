/** Small facts read from a listing's text for display: how fresh it is, years asked for, work mode. */

export type Freshness = "new" | "recent" | "old" | "";

const unitDays: Record<string, number> = { minute: 0, hour: 0, day: 1, week: 7, month: 30, year: 365 };

/** Days since posting from portal wording ("2 days ago", "3+ weeks ago", "Just now"); null when the wording is unknown. */
export function daysAgo(posted: string): number | null {
  const text = posted.trim().toLowerCase();
  if (!text) return null;
  if (/just now|today|few (hours|minutes)|moments? ago/.test(text)) return 0;
  if (/yesterday/.test(text)) return 1;
  const match = /(\d+)\+?\s*(minute|min|hour|hr|day|week|wk|month|mo|year|yr)s?\b/.exec(text);
  if (!match) return null;
  const unit = ({ min: "minute", hr: "hour", wk: "week", mo: "month", yr: "year" } as Record<string, string>)[match[2]!] ?? match[2]!;
  return Number(match[1]) * (unitDays[unit] ?? 0);
}

export function freshness(posted: string): Freshness {
  const days = daysAgo(posted);
  if (days === null) return "";
  if (days <= 3) return "new";
  if (days <= 14) return "recent";
  return days >= 30 ? "old" : "";
}

export interface YearsRange {
  min: number;
  /** undefined for "5+ years" */
  max?: number;
}

/** "12-16 Yrs", "5+ years", "Fresher" → numbers; null when no years are named. */
export function parseYears(text: string): YearsRange | null {
  if (/\bfresher\b/i.test(text)) return { min: 0, max: 1 };
  const match = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*>?\s*(\d{1,2}))?/.exec(text);
  if (!match) return null;
  const min = Number(match[1]);
  const max = match[2] ? Number(match[2]) : /\+|plus/.test(text) ? undefined : min;
  return { min, max };
}

export function formatYears(range: YearsRange): string {
  if (range.min === 0 && range.max !== undefined && range.max <= 1) return "Fresher";
  if (range.max === undefined) return `${range.min}+ yrs`;
  return range.max === range.min ? `${range.min} yrs` : `${range.min}–${range.max} yrs`;
}

const yearsPhrase = String.raw`(\d{1,2}\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?)\s*(?:years?|yrs?)`;
const yearsThenExperience = new RegExp(String.raw`${yearsPhrase}(?:\s+of)?[^.\n]{0,40}?\bexperience`, "i");
const experienceThenYears = new RegExp(String.raw`\bexperience\b[^.\n]{0,30}?${yearsPhrase}`, "i");

/** Years of experience the description asks for; only counts years written next to the word "experience". */
export function yearsFromDescription(text: string): YearsRange | null {
  const match = yearsThenExperience.exec(text) ?? experienceThenYears.exec(text);
  return match ? parseYears(match[1]!) : null;
}

export type Fit = "fits" | "under" | "over" | "";

/** How the candidate's years compare; "" when the profile has no years set. */
export function fit(range: YearsRange, candidateYears: number): Fit {
  if (!candidateYears) return "";
  if (candidateYears < range.min) return "under";
  if (range.max !== undefined && candidateYears > range.max + 3) return "over";
  return "fits";
}

type TypeRule = [label: string, headline: RegExp, body: RegExp];

/** One work mode at most, then arrangements. Headline text (title, location, portal type) is trusted on a bare word; the description only on a clear phrase, since "remote teams" or "contract negotiation" say nothing about the job. */
const modeRules: TypeRule[] = [
  ["Hybrid", /\bhybrid\b/i, /\bhybrid (role|work|model|mode|working|position|setup)\b|\(hybrid\)/i],
  ["Remote", /\bremote\b|\bwork from home\b|\bwfh\b/i, /\b(fully|100%) remote\b|\bremote[- ](role|position|job|opportunity|first|working)\b|\bwork from home\b|\(remote\)/i],
  ["On-site", /\bon[- ]?site\b|\bwork from office\b|\bwfo\b/i, /\bwork from office\b|\bWFO\b|\bon[- ]?site (role|position|job)\b|\(on[- ]?site\)/i],
];
const arrangementRules: TypeRule[] = [
  ["Contract", /\bcontract(ual|or)?\b|\bc2h\b/i, /\bcontract(ual)? (role|position|basis|job|employee|employment)\b|\bcontract[- ]to[- ]hire\b|\bc2h\b|\bon contract\b/i],
  ["Internship", /\bintern(ship)?\b/i, /\binternship\b/i],
  ["Part-time", /\bpart[- _]?time\b/i, /\bpart[- ]time (role|position|job)\b/i],
  ["Full-time", /\bfull[- _]?time\b|\bpermanent\b/i, /\bfull[- ]time (role|position|job|employment|employee|permanent)\b|\bpermanent (role|position)\b/i],
  ["Freelance", /\bfreelance\b/i, /\bfreelance (role|position|project)\b/i],
  ["Temporary", /\btemporary\b/i, /\btemporary (role|position|job)\b/i],
];

const matches = (rule: TypeRule, headline: string, body: string) => rule[1].test(headline) || rule[2].test(body);

/** e.g. ["Remote", "Contract"]; [] when nothing is stated. */
export function jobTypes(headline: string, body = ""): string[] {
  const mode = modeRules.find((rule) => matches(rule, headline, body));
  const arrangements = arrangementRules.filter((rule) => matches(rule, headline, body));
  return [...(mode ? [mode[0]] : []), ...arrangements.map((rule) => rule[0])];
}
