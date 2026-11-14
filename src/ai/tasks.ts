// CONTRACT (owned by supervisor): signatures are fixed; implementations by the AI worker.
import type { FieldDescriptor, JobAnalysis, JobPosting, MustHaveMet, Profile, SalaryEstimate, Seniority } from "../types.ts";
import * as llm from "./llm.ts";
import * as normalize from "./normalize.ts";
const { tokenBudget } = normalize;
import * as layout from "../resume/layout.ts";
import * as rewrite from "../resume/rewrite.ts";
import * as profileExtract from "./profileExtract.ts";
import * as salary from "./salary.ts";
import * as skills from "./skills.ts";

export interface CandidateContext {
  profile: Profile;
  resumeText: string;
}

const jobLimit = 6000;
const resumeLimit = 6000;
const linkedinLimit = 3000;
// profile extraction needs the end of the resume (education, links); 20k chars is ~5k tokens
const fullResumeLimit = 20000;
const noInvention = "Use only facts that appear in the resume or profile. Never invent employers, titles, dates, skills or numbers.";

// ---------- prompt context ----------

function describeJob(job: JobPosting): string {
  const header = [`Title: ${job.title}`, `Company: ${job.company}`, job.location && `Location: ${job.location}`, job.employmentType && `Type: ${job.employmentType}`];
  return `${header.filter(Boolean).join("\n")}\n\nDescription:\n${normalize.truncate(normalize.compact(job.description), jobLimit)}`;
}

export function describeCandidate(candidate: CandidateContext): string {
  const { profile } = candidate;
  const name = `${profile.firstName} ${profile.lastName}`.trim();
  const facts = [
    name && `Name: ${name}`,
    (profile.city || profile.country) && `Location: ${[profile.city, profile.country].filter(Boolean).join(", ")}`,
    profile.workAuthorized && `Authorized to work in their country: ${profile.workAuthorized}`,
    profile.requiresSponsorship && `Needs visa sponsorship: ${profile.requiresSponsorship}`,
    profile.currentTitle && `Current role: ${profile.currentTitle}${profile.currentCompany ? ` at ${profile.currentCompany}` : ""}`,
    profile.yearsExperience > 0 && `Years of experience: ${profile.yearsExperience}`,
    profile.skills.length > 0 && `Skills: ${profile.skills.join(", ")}`,
  ];
  const resume = candidate.resumeText.trim() || profile.experience.map((job) => `${job.title}, ${job.company}: ${job.description}`).join("\n");
  const linkedin = (profile.linkedinSummary ?? "").trim();
  const linkedinSection = linkedin ? `\n\nLinkedIn profile:\n${normalize.truncate(normalize.compact(linkedin), linkedinLimit)}` : "";
  return `${facts.filter(Boolean).join("\n")}\n\nResume:\n${normalize.truncate(normalize.compact(resume), resumeLimit)}${linkedinSection}`;
}

// ---------- analyzeJob ----------

const analysisSystem = `You are a recruiter assessing how well a candidate fits a job. Reply with JSON:
{"mustHave": [{"requirement": "short phrase", "met": "yes" | "partial" | "no"}], "niceToHave": [{"requirement": "short phrase", "met": "yes" | "partial" | "no"}], "seniority": "under" | "match" | "over", "blockers": [short phrases], "strengths": [up to 3 short phrases], "gaps": [up to 3 short phrases], "reason": "one line, at most 15 words", "overview": {"company": [0-3 short sentences], "position": [2-3 short sentences]}}
mustHave: the 3-7 requirements the posting marks as required, in its order. niceToHave: its preferred extras.
"met" judges the candidate's whole background (resume and LinkedIn), not exact wording: an engineering manager meets "2+ years leading teams".
seniority: the candidate's level against the role ("under" = too junior, "over" = clearly more senior than the role).
blockers: only hard conditions the posting states that the candidate's data clearly fails (work authorization, location or onsite, security clearance, license, required language). Unknown is not a blocker; usually empty.
strengths and gaps: the 3 that most affect the decision, citing specifics, never repeating a requirement's wording. reason: the single deciding fact.
overview says why this job might interest the candidate, written to them as "you", one fact from the posting per sentence, at most 12 words each, starting "You'd" or "You get to".
company: what they would join (what it builds, stage or size, domain, customers), e.g. "You'd join a Series B payments company serving retailers". Leave it empty when the posting says nothing about the company.
position: what they would own or do (scope, team, product, impact), e.g. "You get to lead design and development of the platform end to end". Prefer facts that match or stretch the candidate's background.
Leave out requirements, pay and perks (they have their own sections), fit judgments (strengths and gaps cover them) and hype words like "exciting". ${noInvention}`;

const MET_VALUES: MustHaveMet[] = ["yes", "partial", "no"];
const SENIORITY_VALUES: Seniority[] = ["under", "match", "over"];
const MET_POINTS: Record<MustHaveMet, number> = { yes: 1, partial: 0.5, no: 0 };
const SENIORITY_POINTS: Record<Seniority, number> = { match: 1, over: 0.7, under: 0.3 };
const WEIGHTS = { mustHave: 70, seniority: 15, niceToHave: 15 };
const BLOCKER_CAP = 44;

/** Small models answer either plain strings or {requirement, met} objects. An unreadable verdict counts as partial. */
function normalizeRated(raw: unknown, limit: number): { items: string[]; met?: MustHaveMet[] } {
  const entries = Array.isArray(raw) ? raw.slice(0, limit) : [];
  const isRated = entries.some((item) => item && typeof item === "object");
  if (!isRated) return { items: normalize.asStringList(raw, limit) };
  const rated = entries.map((item) => normalize.asRecord(item)).filter((item) => normalize.asString(item.requirement));
  return {
    items: rated.map((item) => normalize.asString(item.requirement)),
    met: rated.map((item) => MET_VALUES.find((value) => value === normalize.asString(item.met).toLowerCase()) ?? "partial"),
  };
}

const average = (met: MustHaveMet[]) => met.reduce((sum, value) => sum + MET_POINTS[value], 0) / met.length;

/** The headline 0-100, computed from the per-requirement ratings so it is stable across runs. Undefined when nothing is rated. */
export function scoreAnalysis(rated: { mustHaveMet?: MustHaveMet[]; niceToHaveMet?: MustHaveMet[]; seniority?: Seniority; blockers: string[] }): number | undefined {
  if (!rated.mustHaveMet?.length) return undefined;
  const parts: [weight: number, ratio: number][] = [[WEIGHTS.mustHave, average(rated.mustHaveMet)]];
  if (rated.seniority) parts.push([WEIGHTS.seniority, SENIORITY_POINTS[rated.seniority]]);
  if (rated.niceToHaveMet?.length) parts.push([WEIGHTS.niceToHave, average(rated.niceToHaveMet)]);
  const totalWeight = parts.reduce((sum, [weight]) => sum + weight, 0);
  const score = Math.round((parts.reduce((sum, [weight, ratio]) => sum + weight * ratio, 0) / totalWeight) * 100);
  return rated.blockers.length ? Math.min(score, BLOCKER_CAP) : score;
}

function verdictFor(score: number): string {
  return score >= 70 ? "Strong match - apply" : score >= 45 ? "Possible match - stretch" : "Weak match - skip";
}

/** fallbackScore is used when the model rated no must-haves and gave no score of its own. */
export function normalizeAnalysis(raw: unknown, fallbackScore = 0): Omit<JobAnalysis, "salary" | "analyzedAt" | "keywordScore" | "matchedSkills" | "missingSkills"> {
  const data = normalize.asRecord(raw);
  const mustHave = normalizeRated(data.mustHave, 12);
  const niceToHave = normalizeRated(data.niceToHave, 10);
  const seniority = SENIORITY_VALUES.find((value) => value === normalize.asString(data.seniority).toLowerCase());
  const blockers = normalize.asStringList(data.blockers, 3);
  const rawOverview = normalize.asRecord(data.overview);
  const overview = { company: normalize.asStringList(rawOverview.company, 3), position: normalize.asStringList(rawOverview.position, 3) };
  const computed = scoreAnalysis({ mustHaveMet: mustHave.met, niceToHaveMet: niceToHave.met, seniority, blockers });
  const ownScore = data.matchScore === undefined ? fallbackScore : normalize.asScore(data.matchScore);
  const base = computed ?? ownScore;
  const score = blockers.length ? Math.min(base, BLOCKER_CAP) : base;
  return {
    summary: normalize.asString(data.summary),
    overview: overview.company.length || overview.position.length ? overview : undefined,
    mustHave: mustHave.items,
    mustHaveMet: mustHave.met,
    niceToHave: niceToHave.items,
    niceToHaveMet: niceToHave.met,
    seniority,
    blockers,
    reason: normalize.asString(data.reason),
    matchScore: score,
    strengths: normalize.asStringList(data.strengths, 3),
    gaps: normalize.asStringList(data.gaps, 3),
    verdict: verdictFor(score),
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
  return { ...normalizeAnalysis(raw, keywords.score), keywordScore: keywords.score, matchedSkills: keywords.matched, missingSkills: keywords.missing };
}

// ---------- keywordMatch ----------

/** Deterministic 0-100 overlap of job skills/keywords with the candidate's skills + resume text. Pure. */
export function keywordMatch(
  jobText: string,
  candidate: CandidateContext,
): { score: number; matched: string[]; missing: string[] } {
  const wanted = skills.skillsIn(jobText);
  const haystack = `${candidate.profile.skills.join("\n")}\n${candidate.resumeText}\n${candidate.profile.linkedinSummary ?? ""}`;
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

function describeFields(fields: FieldDescriptor[]): string {
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

function cleanText(text: string): string {
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
function removePlaceholders(letter: string, job: JobPosting): string {
  return letter
    .replace(/\[[^\]\n]*company[^\]\n]*\]/gi, job.company)
    .replace(/^\s*\[[^\]\n]+\]\s*$/gm, "")
    .replace(/\[[^\]\n]+\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Tone = "professional" | "enthusiastic" | "concise";

const toneGuides: Record<Tone, { voice: string; format: string }> = {
  professional: {
    voice: "confident and warm, like a sharp colleague writing to a hiring manager; polished but never stiff",
    format: "a one-line greeting, then 3 short paragraphs of 2-3 sentences each",
  },
  enthusiastic: {
    voice: "upbeat and personal, with genuine interest in what the company builds; energy without hype",
    format: "a one-line greeting, then 3 short paragraphs of 2-3 sentences each",
  },
  concise: {
    voice: "very tight and direct, every line earns its place",
    format: "a one-line greeting, a 2-line opener, then exactly 3 punchy bullets (start each with '- ') with a real result or skill each, then a one-line close",
  },
};

const bannedOpeners = '"I am writing to express my interest", "I am excited to apply", "I believe I would be a great fit", "Please find attached", "Dear Sir or Madam"';

function coverLetterSystem(tone: Tone, words: number): string {
  const guide = toneGuides[tone] ?? toneGuides.professional;
  return `You write short, modern cover letters. A busy recruiter skims them in 20 seconds and an ATS keyword screener also reads them.
Length: about ${words} words, never more than ${words + 30}. Plain text only, no markdown, no bold.
Voice: ${guide.voice}. First person, conversational, plain words, contractions are fine. Never use stock phrases such as ${bannedOpeners}.
Structure: ${guide.format}. Greet with "Hi <hiring manager>," if a person is named, otherwise "Hi <company> team,".
Open by naming the role and the strongest specific reason the candidate fits (a real result or number from the resume). Close with one short line inviting a chat, then "Best," and the candidate's name if known.
Keywords: work the job's must-have skills, tools and terms into real sentences about real work, using the job's own wording, but only ones the candidate truly has according to the resume, profile or LinkedIn text. Never list keywords, never claim a skill or tool the candidate lacks.
Use the real company and role names; never leave placeholders like [Company] or [Your Name]. ${noInvention}`;
}

function keywordHint(job: JobPosting, candidate: CandidateContext): string {
  const { matched } = keywordMatch(`${job.title}\n${job.description}`, candidate);
  return matched.length ? `\n\nJOB KEYWORDS THE CANDIDATE HAS (use the most relevant naturally)\n${matched.join(", ")}` : "";
}

export async function writeCoverLetter(
  client: llm.LlmClient,
  job: JobPosting,
  candidate: CandidateContext,
  options: { tone: Tone; words: number },
): Promise<string> {
  const words = normalize.clamp(Math.round(options.words), 80, 300);
  const text = await client.chat({
    system: coverLetterSystem(options.tone, words),
    user: `JOB\n${describeJob(job)}\n\nCANDIDATE\n${describeCandidate(candidate)}${keywordHint(job, candidate)}`,
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

function normalizeTailoring(raw: unknown, candidate: CandidateContext): { markdown: string; changes: { before: string; after: string; reason: string }[] } {
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

// ---------- tailorPdf ----------

const pdfTailorSystem = `You tailor a resume to a job by rewriting individual lines in place. The resume is a fixed-layout PDF, so every rewrite must fit the space of the lines it replaces. Reply with JSON: {"rewrites": [{"id": "b1_3", "newText": "...", "reason": "..."}]}
The resume is shown as plain text. Editable blocks start with [id | N lines | max C chars]; everything else is context you must not change.
Rules:
- Rewrite only blocks that gain from the job: the summary and bullets. Usually 4-10 blocks; leave every other block out of the reply.
- newText must be at most C characters. Plain text: no bullet symbol, no markdown, no emoji, no arrows.
- Keep the meaning and every employer, title, date, number and metric exactly. You may tighten and re-word, and use the job's own terms where the candidate genuinely did that work.
- Never add skills, tools, numbers or responsibilities that are not in the resume or the candidate's skills list. Do not give the candidate the job's title or seniority, and do not attach job words (like "AI") to work the resume does not describe that way.
- Never touch contact details, job titles, company names, dates, education or awards.
- reason: one short phrase, e.g. "Surfaces 'platform' and 'GenAI' from the job".`;

const shortenSystem = `Each rewrite below is too long to fit its space in a fixed-layout resume. Shorten each one to at most its max chars, keeping the key facts, numbers and the job-relevant terms. No new facts. Reply with JSON: {"rewrites": [{"id": "...", "newText": "...", "reason": "..."}]}`;

async function shortenOverlong(client: llm.LlmClient, overlong: rewrite.Overlong[], resume: layout.Layout, measurer: rewrite.Measurer): Promise<rewrite.Placement[]> {
  if (overlong.length === 0) return [];
  const lines = overlong.map(({ rewrite: attempt, maxChars }) => JSON.stringify({ id: attempt.id, maxChars, newText: attempt.newText, reason: attempt.reason }));
  try {
    const raw = await llm.chatJson<unknown>(client, { system: shortenSystem, user: lines.join("\n"), maxTokens: tokenBudget });
    const wanted = new Set(overlong.map((item) => item.rewrite.id));
    const shortened = rewrite.parse(raw).filter((item) => wanted.has(item.id));
    return rewrite.validate(shortened, resume, measurer).placements;
  } catch {
    return [];
  }
}

/** Line rewrites for a PDF resume, each verified to fit the lines it replaces. Rewrites that still do not fit after one retry are dropped. */
export async function tailorPdf(
  client: llm.LlmClient,
  job: JobPosting,
  candidate: CandidateContext,
  resume: layout.Layout,
  measurer: rewrite.Measurer,
): Promise<rewrite.Placement[]> {
  const skillsLine = candidate.profile.skills.length ? `\n\nCANDIDATE SKILLS\n${candidate.profile.skills.join(", ")}` : "";
  const raw = await llm.chatJson<unknown>(client, {
    system: pdfTailorSystem,
    user: `JOB\n${describeJob(job)}${keywordHint(job, candidate)}${skillsLine}\n\nRESUME\n${normalize.truncate(rewrite.describe(resume), fullResumeLimit)}`,
    maxTokens: tokenBudget,
  });
  const first = rewrite.validate(rewrite.parse(raw), resume, measurer);
  const retried = await shortenOverlong(client, first.overlong, resume, measurer);
  const order = new Map(layout.allBlocks(resume).map((block, index) => [block.id, index]));
  const truthful = [...first.placements, ...retried].filter((placement) => !addsSkill(placement, candidate));
  return truthful.sort((a, b) => order.get(a.block.id)! - order.get(b.block.id)!);
}

/** The model keeps adding the job's skills (e.g. "Backend systems") despite the prompt; a rewrite naming a skill the candidate never mentions is dropped. */
function addsSkill(placement: rewrite.Placement, candidate: CandidateContext): boolean {
  const known = `${candidate.profile.skills.join("\n")}\n${candidate.resumeText}\n${candidate.profile.linkedinSummary ?? ""}`;
  const original = placement.block.text;
  return skills.skillsIn(placement.lines.join(" ")).some((skill) => !skills.hasSkill(skill, known) && !skills.hasSkill(skill, original));
}
