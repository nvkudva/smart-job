import * as llm from "../ai/llm.ts";
import * as tasks from "../ai/tasks.ts";
import type { ApplyClick } from "../messages.ts";
import { listFrameIds, sendToFrame } from "../messages.ts";
import * as storage from "../storage.ts";
import type { FieldDescriptor, FieldFill, FillResult, JobPosting, Profile, Resume } from "../types.ts";
import * as mapping from "./mapping.ts";

export interface FillReportItem {
  field: FieldDescriptor;
  fill: FieldFill | null;
  result: FillResult | null;
}

export interface FillReport {
  items: FillReportItem[];
  filledCount: number;
  needsReviewCount: number;
}

const QUESTION_KINDS = new Set(["textarea", "select", "radio", "combobox"]);
const MAX_AI_OPTIONS = 80;

async function scanAllFrames(tabId: number): Promise<FieldDescriptor[]> {
  const fields: FieldDescriptor[] = [];
  for (const frameId of await listFrameIds(tabId)) {
    const scanned = (await sendToFrame(tabId, frameId, { type: "scanFields" })) ?? [];
    fields.push(...scanned.map((field) => ({ ...field, frameId })));
  }
  return fields;
}

/** The first frame (top frame first) that has an Apply control; it is clicked there, or its link is returned. */
export async function clickApply(tabId: number): Promise<ApplyClick> {
  const frameIds = [...(await listFrameIds(tabId))].sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : a - b));
  for (const frameId of frameIds) {
    const outcome = await sendToFrame(tabId, frameId, { type: "clickApply" });
    if (outcome && outcome.result !== "none") return outcome;
  }
  return { result: "none" };
}

const isSingleCheckbox = (field: FieldDescriptor) => field.kind === "checkbox" && field.options.length < 2;

const CONSENT = /privacy (policy|notice)|terms (of|and) (use|service|conditions)|\bconsent\b|\bi agree\b/i;

const isEmpty = (field: FieldDescriptor) => field.currentValue.trim() === "" || field.currentValue === "false";

function needsAnswer(field: FieldDescriptor): boolean {
  if (field.kind === "file" || field.kind === "password" || !isEmpty(field)) return false;
  return field.required || QUESTION_KINDS.has(field.kind) || (field.kind === "checkbox" && !isSingleCheckbox(field));
}

async function askAi(
  leftovers: FieldDescriptor[],
  context: { profile: Profile; resume: Resume | null; job: JobPosting | null },
): Promise<{ fills: FieldFill[]; failed: boolean }> {
  if (!leftovers.length) return { fills: [], failed: false };
  try {
    const settings = await storage.get("settings");
    const trimmed = leftovers.map((field) => ({ ...field, options: field.options.slice(0, MAX_AI_OPTIONS) }));
    const answers = await tasks.answerFields(llm.create(settings.provider), trimmed, { profile: context.profile, resumeText: context.resume?.text ?? "" }, context.job);
    return { fills: aiFills(leftovers, answers), failed: false };
  } catch (error) {
    console.warn("[SmartJob] AI answers failed", error);
    return { fills: [], failed: true };
  }
}

function matchAnswer(field: FieldDescriptor, answer: string): string | undefined {
  if (field.kind !== "checkbox") return mapping.matchOption(field.options, answer);
  const picked = answer.split(/\s*(?:\||;|\n)\s*/).flatMap((part) => mapping.matchOption(field.options, part) ?? []);
  return picked.length ? [...new Set(picked)].join(mapping.ALTERNATIVES_SEPARATOR) : undefined;
}

function aiFills(leftovers: FieldDescriptor[], answers: Record<string, string>): FieldFill[] {
  const fills: FieldFill[] = [];
  for (const field of leftovers) {
    const answer = answers[field.id]?.trim();
    if (!answer) continue;
    const value = field.options.length && field.kind !== "combobox" ? matchAnswer(field, answer) : answer;
    if (value) fills.push({ id: field.id, frameId: field.frameId, value, source: "ai" });
  }
  return fills;
}

async function sendFills(tabId: number, fills: FieldFill[], resume: Resume | null): Promise<Map<string, FillResult>> {
  const results = new Map<string, FillResult>();
  const byFrame = Map.groupBy(fills, (fill) => fill.frameId);
  for (const [frameId, frameFills] of byFrame) {
    const needsFile = resume?.fileBase64 && frameFills.some((fill) => fill.source === "resume");
    const resumeFile = needsFile ? { name: resume.fileName, base64: resume.fileBase64, mimeType: resume.mimeType } : undefined;
    const response = await sendToFrame(tabId, frameId, { type: "fillFields", fills: frameFills, resumeFile });
    for (const result of response ?? []) results.set(`${frameId}:${result.id}`, result);
  }
  return results;
}

const keyOf = (item: { frameId: number; id: string }) => `${item.frameId}:${item.id}`;

/** scan all frames → deterministic map → answer bank → AI for leftovers → fill → report. */
export async function run(tabId: number, job: JobPosting | null, options: { useAi: boolean; includeAccount: boolean }): Promise<FillReport> {
  const fields = await scanAllFrames(tabId);
  const [profile, resume, answers, settings] = await Promise.all([storage.get("profile"), storage.get("resume"), storage.get("answers"), storage.get("settings")]);

  const fills = mapping.map(fields, profile, answers, resume, options.includeAccount ? settings.account : undefined);
  const filledKeys = new Set(fills.map(keyOf));
  // agreeing to terms, privacy policies or consent is the user's decision: single checkboxes and consent questions never go to the model
  const leftovers = fields.filter((field) => !filledKeys.has(keyOf(field)) && needsAnswer(field) && !isSingleCheckbox(field) && !CONSENT.test(`${field.label} ${field.options.join(" ")}`));
  const ai = options.useAi ? await askAi(leftovers, { profile, resume, job }) : { fills: [], failed: false };
  const allFills = [...fills, ...ai.fills];

  const results = await sendFills(tabId, allFills, resume);
  return buildReport(fields, allFills, results, ai.failed);
}

function buildReport(fields: FieldDescriptor[], fills: FieldFill[], results: Map<string, FillResult>, hasAiFailed: boolean): FillReport {
  const fillByKey = new Map(fills.map((fill) => [keyOf(fill), fill]));
  const items: FillReportItem[] = [];
  let filledCount = 0;
  let needsReviewCount = 0;
  for (const field of fields) {
    const fill = fillByKey.get(keyOf(field)) ?? null;
    const result = results.get(keyOf(field)) ?? null;
    const isFilled = result?.ok === true;
    if (!fill && !needsAnswer(field)) continue;
    if (isFilled) filledCount++;
    const isUnanswered = !isFilled && (field.required || hasAiFailed);
    if (isUnanswered || (isFilled && fill?.source === "ai")) needsReviewCount++;
    items.push({ field, fill, result });
  }
  return { items, filledCount, needsReviewCount };
}

/** Re-apply user-edited values (source "user"), optionally saving them to the answer bank. */
export async function apply(tabId: number, fills: FieldFill[], saveToAnswerBank: boolean, fields: FieldDescriptor[]): Promise<FillResult[]> {
  const resume = fills.some((fill) => fill.source === "resume") ? await storage.get("resume") : null;
  const results = await sendFills(tabId, fills, resume);
  if (saveToAnswerBank) await saveAnswers(fills, fields);
  return fills.flatMap((fill) => results.get(keyOf(fill)) ?? []);
}

async function saveAnswers(fills: FieldFill[], fields: FieldDescriptor[]): Promise<void> {
  const fieldByKey = new Map(fields.map((field) => [keyOf(field), field]));
  const now = Date.now();
  await storage.update("answers", (answers) => {
    const next = { ...answers };
    for (const fill of fills) {
      const field = fieldByKey.get(keyOf(fill));
      const key = field ? mapping.normalize(field.label) : "";
      if (key && fill.source === "user" && fill.value.trim() && field?.kind !== "file" && field?.kind !== "password") next[key] = { question: field!.label, answer: fill.value, updatedAt: now };
    }
    return next;
  });
}
