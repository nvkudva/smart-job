import type { JobSearch, Profile } from "../types.ts";
import * as llm from "./llm.ts";
import * as normalize from "./normalize.ts";

const maxRoles = 8;

const rolesSystem = `You suggest job titles a candidate should search for. Reply with JSON: {"roles":[string]}
Rules: 5 to 8 standard job titles as they appear in job postings, most relevant first.
1. First the title the candidate states they want, only if the objective / summary names a concrete title ("Senior leadership role" is not one); otherwise their latest employed title as it appears in postings (drop internal levels like "II": "Engineering Manager II" → "Engineering Manager").
2. Then exactly the next two levels up that same ladder, one step at a time (Engineering Manager → Senior Engineering Manager → Director of Engineering). Never skip levels.
3. Then up to three adjacent titles at the same levels that fit their skills.
A career break, sabbatical or freelance stint is not a title.
No duplicates, no company names, no seniority words that do not appear in real titles.`;

export function describeCandidate(profile: Profile): string {
  const recent = profile.experience.slice(0, 3).map((job) => `${job.title} at ${job.company}`.trim());
  const latestEmployed = profile.experience.find((job) => job.company);
  return [
    `Latest employed title: ${latestEmployed ? `${latestEmployed.title} at ${latestEmployed.company}` : profile.currentTitle || "unknown"}`,
    `Headline: ${profile.headline}`,
    `Summary: ${normalize.truncate(profile.summary, 600)}`,
    `Years of experience: ${profile.yearsExperience}`,
    `Recent roles: ${recent.join("; ")}`,
    `Skills: ${profile.skills.slice(0, 15).join(", ")}`,
  ].join("\n");
}

export function fallback(profile: Profile): string[] {
  const title = profile.currentTitle || profile.experience[0]?.title || "";
  return title ? [title] : [];
}

export function parseRoles(raw: unknown, profile: Profile): string[] {
  const roles = normalize.asStringList(normalize.asRecord(raw).roles, maxRoles);
  return roles.length ? roles : fallback(profile);
}

export async function suggest(client: llm.LlmClient, profile: Profile): Promise<string[]> {
  const raw = await llm.chatJson<unknown>(client, { system: rolesSystem, user: describeCandidate(profile), maxTokens: normalize.tokenBudget });
  return parseRoles(raw, profile);
}

/** LinkedIn's 2026 search ignores the location parameter but understands "<role> in <place>" typed as the query. */
export function searchUrl(role: string, location: string, isRemote: boolean): string {
  const query = [isRemote ? "Remote" : "", role, location ? `in ${location}` : ""].filter(Boolean).join(" ");
  return `https://www.linkedin.com/jobs/search-results/?keywords=${encodeURIComponent(query)}`;
}

export function buildSearches(roles: string[], location: string, isRemote: boolean): JobSearch[] {
  const place = location.trim();
  return roles.map((role) => ({ role, location: place, url: searchUrl(role, place, isRemote) }));
}
