// CONTRACT (owned by supervisor): signatures are fixed; implementations by the AI worker.
import type { FieldDescriptor, JobAnalysis, JobPosting, Profile, SalaryEstimate } from "../types.ts";
import * as llm from "./llm.ts";
import * as normalize from "./normalize.ts";
const { tokenBudget } = normalize;
import * as profileExtract from "./profileExtract.ts";
import * as salary from "./salary.ts";
import * as skills from "./skills.ts";

export interface CandidateContext {
  profile: Profile;
  resumeText: string;
}

const jobLimit = 6000;
const resumeLimit = 6000;
// profile extraction needs the end of the resume (education, links); 20k chars is ~5k tokens
const fullResumeLimit = 20000;
const noInvention = "Use only facts that appear in the resume or profile. Never invent employers, titles, dates, skills or numbers.";

// ---------- prompt context ----------

export function describeJob(job: JobPosting): string {
  const header = [`Title: ${job.title}`, `Company: ${job.company}`, job.location && `Location: ${job.location}`, job.employmentType && `Type: ${job.employmentType}`];
  return `${header.filter(Boolean).join("\n")}\n\nDescription:\n${normalize.truncate(job.description, jobLimit)}`;
}

export function describeCandidate(candidate: CandidateContext): string {
  const { profile } = candidate;
  const name = `${profile.firstName} ${profile.lastName}`.trim();
  const facts = [
    name && `Name: ${name}`,
    profile.currentTitle && `Current role: ${profile.currentTitle}${profile.currentCompany ? ` at ${profile.currentCompany}` : ""}`,
    profile.yearsExperience > 0 && `Years of experience: ${profile.yearsExperience}`,
    profile.skills.length > 0 && `Skills: ${profile.skills.join(", ")}`,
  ];
  const resume = candidate.resumeText.trim() || profile.experience.map((job) => `${job.title}, ${job.company}: ${job.description}`).join("\n");
  return `${facts.filter(Boolean).join("\n")}\n\nResume:\n${normalize.truncate(resume, resumeLimit)}`;
}

// ---------- analyzeJob ----------

const analysisSystem = `You are a recruiter assessing how well a candidate fits a job. Reply with JSON:
{"summary": "3-5 sentences about the role", "mustHave": [short phrases], "niceToHave": [short phrases], "matchScore": 0-100, "strengths": [short phrases], "gaps": [short phrases], "verdict": "one line, e.g. Strong match - apply"}
Scoring rubric for matchScore: must-have requirements covered = up to 60 points, experience level/seniority fit = up to 25, nice-to-have covered = up to 15. Be honest; do not inflate.
strengths and gaps compare the candidate to the job, citing specifics. ${noInvention}`;

export function normalizeAnalysis(raw: unknown): Omit<JobAnalysis, "salary" | "analyzedAt" | "keywordScore" | "matchedSkills" | "missingSkills"> {
  const data = normalize.asRecord(raw);
  const score = normalize.asScore(data.matchScore);
  return {
    summary: normalize.asString(data.summary),
    mustHave: normalize.asStringList(data.mustHave, 12),
    niceToHave: normalize.asStringList(data.niceToHave, 10),
    matchScore: score,
    strengths: normalize.asStringList(data.strengths, 6),
    gaps: normalize.asStringList(data.gaps, 6),
    verdict: normalize.asString(data.verdict) || (score >= 70 ? "Strong match" : score >= 45 ? "Possible match" : "Weak match"),
  };
}

export async function analyzeJob(
  client: llm.LlmClient,
  job: JobPosting,
  candidate: CandidateContext,
): Promise<Omit<JobAnalysis, "salary" | "analyzedAt">> {
  const raw = await llm.chatJson<unknown>(client, {
    system: analysisSystem,
    user: `JOB\n${describeJob(job)}\n\nCANDIDATE\n${describeCandidate(candidate)}`,
    maxTokens: tokenBudget,
  });
  const keywords = keywordMatch(`${job.title}\n${job.description}`, candidate);
  return { ...normalizeAnalysis(raw), keywordScore: keywords.score, matchedSkills: keywords.matched, missingSkills: keywords.missing };
}

// ---------- keywordMatch ----------

/** Deterministic 0-100 overlap of job skills/keywords with the candidate's skills + resume text. Pure. */
export function keywordMatch(
  jobText: string,
  candidate: CandidateContext,
): { score: number; matched: string[]; missing: string[] } {
  const wanted = skills.skillsIn(jobText);
  const haystack = `${candidate.profile.skills.join("\n")}\n${candidate.resumeText}`;
  const matched = wanted.filter((skill) => skills.hasSkill(skill, haystack));
  const missing = wanted.filter((skill) => !matched.includes(skill));
  const score = wanted.length ? Math.round((matched.length / wanted.length) * 100) : 0;
  return { score, matched, missing };
}

// ---------- estimateSalary / extractProfile ----------

/** Posted salary → web search (DuckDuckGo HTML) + LLM extraction → LLM estimate from nearest equivalents. */
export async function estimateSalary(
  client: llm.LlmClient,
  job: JobPosting,
  options: { webSearch: boolean },
): Promise<SalaryEstimate> {
  return salary.estimate(client, job, options);
}

/** Structured profile from resume text. Unknown fields stay "" / []. */
export async function extractProfile(client: llm.LlmClient, resumeText: string): Promise<Profile> {
  const raw = await llm.chatJson<unknown>(client, {
    system: profileExtract.profileSystem,
    user: `Resume:\n${normalize.truncate(resumeText, fullResumeLimit)}`,
    maxTokens: tokenBudget,
  });
  return profileExtract.buildProfile(raw, resumeText);
}

// ---------- answerFields ----------

const fieldsSystem = `You fill in job application form fields for a candidate. Reply with JSON: {"answers": {"<field id>": "<answer>"}}
Rules:
- Answer only fields you can answer from the candidate data; omit the rest.
- For fields with "options", the answer must be exactly one of the option texts, copied verbatim.
- checkbox with no options: "true" or "false". checkbox with options (a group): one or more option texts joined by " | ".
- For demographic / EEO questions (gender, race, veteran, disability), choose the option meaning "decline to answer" / "prefer not to say" unless the profile states otherwise.
- Free-text questions like "why this company/role": first person, 60-120 words, specific to the job context, no cliches ("passionate", "dynamic", "fast-paced").
- ${noInvention}`;

export function describeFields(fields: FieldDescriptor[]): string {
  const lines = fields.map((field) =>
    JSON.stringify({
      id: field.id,
      kind: field.kind,
      label: field.label || field.placeholder || field.name,
      section: field.section || undefined,
      required: field.required || undefined,
      options: field.options.length ? field.options.slice(0, 60) : undefined,
    }),
  );
  return lines.join("\n");
}

function closestOption(answer: string, options: string[]): string | null {
  const target = normalize.comparable(answer);
  if (!target) return null;
  const normalized = options.map(normalize.comparable);
  const exact = normalized.indexOf(target);
  if (exact >= 0) return options[exact]!;
  const contained = normalized.findIndex((option) => option && (option.includes(target) || target.includes(option)));
  if (contained >= 0) return options[contained]!;
  const best = normalized.map((option, index) => ({ index, score: tokenOverlap(target, option) })).sort((a, b) => b.score - a.score)[0];
  return best && best.score >= 0.5 ? options[best.index]! : null;
}

function tokenOverlap(a: string, b: string): number {
  const left = new Set(a.split(" "));
  const right = new Set(b.split(" "));
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / Math.max(1, new Set([...left, ...right]).size);
}

function rawAnswers(raw: unknown): Record<string, unknown> {
  const data = normalize.asRecord(raw);
  if (Array.isArray(data.answers)) {
    return Object.fromEntries(data.answers.map(normalize.asRecord).map((item) => [normalize.asString(item.id), item.answer ?? item.value]));
  }
  return Object.keys(normalize.asRecord(data.answers)).length ? normalize.asRecord(data.answers) : data;
}

/** Drops unknown ids, file fields, empties, and choice answers that match no option. */
export function normalizeAnswers(raw: unknown, fields: FieldDescriptor[]): Record<string, string> {
  const byId = new Map(fields.map((field) => [field.id, field]));
  const answers: Record<string, string> = {};
  for (const [id, value] of Object.entries(rawAnswers(raw))) {
    const field = byId.get(id);
    const text = typeof value === "boolean" ? String(value) : normalize.asString(value);
    if (!field || field.kind === "file" || !text) continue;
    if (field.options.length === 0 || field.kind === "checkbox") {
      answers[id] = text;
      continue;
    }
    const option = closestOption(text, field.options);
    if (option) answers[id] = option;
  }
  return answers;
}

/** Answers for fields the deterministic mapper could not fill. Returns fieldId -> value (option text for choice fields). Omit fields it cannot answer. */
export async function answerFields(
  client: llm.LlmClient,
  fields: FieldDescriptor[],
  candidate: CandidateContext,
  job: JobPosting | null,
): Promise<Record<string, string>> {
  const answerable = fields.filter((field) => field.kind !== "file");
  if (answerable.length === 0) return {};
  const raw = await llm.chatJson<unknown>(client, {
    system: fieldsSystem,
    user: `FIELDS (one JSON per line)\n${describeFields(answerable)}\n\nCANDIDATE\n${describeCandidate(candidate)}\n\nJOB\n${job ? describeJob(job) : "(none)"}`,
    maxTokens: tokenBudget,
  });
  return normalizeAnswers(raw, answerable);
}

// ---------- writing ----------

const questionSystem = `You answer a job application question on behalf of the candidate. First person, concrete, no cliches, no preamble, no quotation marks. Answer only with the answer text; 60-120 words unless the question needs a shorter answer (a number, yes/no). ${noInvention}`;

export function cleanText(text: string): string {
  return text.replace(/^```\w*\n?|\n?```$/g, "").replace(/^["“](.*)["”]$/s, "$1").trim();
}

export async function answerQuestion(
  client: llm.LlmClient,
  question: string,
  candidate: CandidateContext,
  job: JobPosting | null,
): Promise<string> {
  const text = await client.chat({
    system: questionSystem,
    user: `QUESTION\n${question}\n\nCANDIDATE\n${describeCandidate(candidate)}\n\nJOB\n${job ? describeJob(job) : "(none)"}`,
    maxTokens: tokenBudget,
  });
  return cleanText(text);
}

/** Replaces [Company]-style placeholders with real values, and drops any other bracketed placeholder. */
export function removePlaceholders(letter: string, job: JobPosting): string {
  return letter
    .replace(/\[[^\]\n]*company[^\]\n]*\]/gi, job.company)
    .replace(/^\s*\[[^\]\n]+\]\s*$/gm, "")
    .replace(/\[[^\]\n]+\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function writeCoverLetter(
  client: llm.LlmClient,
  job: JobPosting,
  candidate: CandidateContext,
  options: { tone: "professional" | "enthusiastic" | "concise"; words: number },
): Promise<string> {
  const text = await client.chat({
    system: `You write cover letters. Tone: ${options.tone}. Length: about ${options.words} words. Plain text only, no markdown. Open with "Dear Hiring Team," unless a hiring manager is named. Connect the candidate's real experience to the job's main requirements with specifics. Use the real company and role names; never leave placeholders like [Company] or [Your Name]. Sign off with the candidate's name if known. ${noInvention}`,
    user: `JOB\n${describeJob(job)}\n\nCANDIDATE\n${describeCandidate(candidate)}`,
    maxTokens: tokenBudget,
  });
  return removePlaceholders(cleanText(text), job);
}

// ---------- tailorResume ----------

const tailorSystem = `You tailor a resume to a job description. Reply with JSON: {"markdown": "the full tailored resume in markdown", "changes": [{"before": "original text", "after": "new text", "reason": "why"}]}
Rules:
- Keep every employer, job title, date, degree and school exactly unchanged.
- You may only rephrase the summary and bullet points, and reorder skills, to surface keywords from the job that the candidate genuinely has.
- Never add skills, tools, metrics or responsibilities that are not in the original resume.
- List each rewritten line in "changes".`;

export function normalizeTailoring(raw: unknown, candidate: CandidateContext): { markdown: string; changes: { before: string; after: string; reason: string }[] } {
  const data = normalize.asRecord(raw);
  const markdown = typeof data.markdown === "string" && data.markdown.trim() ? data.markdown.trim() : candidate.resumeText;
  const changes = (Array.isArray(data.changes) ? data.changes : [])
    .map(normalize.asRecord)
    .map((item) => ({ before: normalize.asString(item.before), after: normalize.asString(item.after), reason: normalize.asString(item.reason) }))
    .filter((change) => change.after);
  const missing = candidate.profile.experience.map((job) => job.company).filter((company) => company && !markdown.toLowerCase().includes(company.toLowerCase()));
  for (const company of missing) {
    changes.push({ before: company, after: "", reason: `Warning: employer "${company}" is missing from the tailored resume. Review before using.` });
  }
  return { markdown, changes };
}

/** Rewrites summary/bullets toward the JD without inventing facts. markdown = full resume. */
export async function tailorResume(
  client: llm.LlmClient,
  job: JobPosting,
  candidate: CandidateContext,
): Promise<{ markdown: string; changes: { before: string; after: string; reason: string }[] }> {
  const raw = await llm.chatJson<unknown>(client, {
    system: tailorSystem,
    user: `JOB\n${describeJob(job)}\n\nORIGINAL RESUME\n${normalize.truncate(candidate.resumeText || describeCandidate(candidate), resumeLimit)}`,
    maxTokens: tokenBudget,
  });
  return normalizeTailoring(raw, candidate);
}
