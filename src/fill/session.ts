import * as llm from "../ai/llm.ts";
import * as tasks from "../ai/tasks.ts";
import type { ApplyClick } from "../messages.ts";
import { listFrameIds, sendToFrame } from "../messages.ts";
import * as sessionTabs from "../sessionTabs.ts";
import * as storage from "../storage.ts";
import type { AnswerBank, FieldDescriptor, FieldFill, FillResult, JobPosting, Profile, Resume } from "../types.ts";
import * as learning from "./learning.ts";
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
  /** fields the scan found, including ones already filled (which never become items) */
  fieldCount: number;
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

const isEmpty = (field: FieldDescriptor) => field.currentValue.trim() === "" || field.currentValue === "false";

function needsAnswer(field: FieldDescriptor): boolean {
  if (field.kind === "file" || field.kind === "password" || !isEmpty(field)) return false;
  return field.required || QUESTION_KINDS.has(field.kind) || (field.kind === "checkbox" && !learning.isSingleCheckbox(field));
}

async function askAi(
  leftovers: FieldDescriptor[],
  context: { profile: Profile; resume: Resume | null; job: JobPosting | null; answers: AnswerBank },
): Promise<{ fills: FieldFill[]; failed: boolean }> {
  if (!leftovers.length) return { fills: [], failed: false };
  try {
    const settings = await storage.get("settings");
    const trimmed = leftovers.map((field) => ({ ...field, options: field.options.slice(0, MAX_AI_OPTIONS) }));
    const answers = await tasks.answerFields(llm.create(settings.provider), trimmed, { profile: context.profile, resumeText: context.resume?.text ?? "" }, context.job, learning.similarAnswers(context.answers, leftovers));
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

async function hostOf(tabId: number): Promise<string> {
  try {
    return new URL((await chrome.tabs.get(tabId)).url ?? "").hostname;
  } catch {
    return "";
  }
}

/** Clears pills and outlines left by an earlier run, in every frame (a frame without fills this time would otherwise keep them). */
async function clearHighlights(tabId: number): Promise<void> {
  const frameIds = await listFrameIds(tabId);
  await Promise.all(frameIds.map((frameId) => sendToFrame(tabId, frameId, { type: "clearHighlights" })));
}

/** Fields still needing the user once the pass is done (nothing filled, or the fill failed), in page order. */
function unknownFields(fields: FieldDescriptor[], results: Map<string, FillResult>): FieldDescriptor[] {
  return fields.filter((field) => needsAnswer(field) && results.get(keyOf(field))?.ok !== true);
}

/** After all the known fields are filled: a pill on every unknown one, and a jump to the first. */
async function pointAtUnknown(tabId: number, unknown: FieldDescriptor[]): Promise<void> {
  const byFrame = Map.groupBy(unknown, (field) => field.frameId);
  let shouldScroll = true;
  for (const [frameId, frameFields] of byFrame) {
    const marked = frameFields.map((field) => ({ id: field.id, isRequired: field.required }));
    await sendToFrame(tabId, frameId, { type: "markUnknown", unknown: marked, shouldScroll });
    shouldScroll = false;
  }
}

async function logMisses(tabId: number, unknown: FieldDescriptor[], fills: FieldFill[], results: Map<string, FillResult>): Promise<void> {
  const fillByKey = new Map(fills.map((fill) => [keyOf(fill), fill]));
  const entries = unknown.filter(learning.isLoggable).map((field) => {
    const fill = fillByKey.get(keyOf(field));
    const result = results.get(keyOf(field));
    if (!fill) return learning.entryOf(field, "unanswered", "none", "", "");
    return learning.entryOf(field, "failed", fill.source, fill.value, result?.finalValue ?? "", result?.error ?? "no response from the page");
  });
  await learning.log(await hostOf(tabId), entries);
}

/**
 * Some portals (iCIMS) reload the page when a file is attached and drop the other fields; attaching again on the reloaded page would loop forever.
 * Kept in session storage because the panel and the resume editor tab are separate pages that both attach files.
 */
const uploadedPage = (tabId: number) => sessionTabs.read<string>("uploadedResumePage", tabId);
const markResumeUploaded = (tabId: number, pageKey: string) => sessionTabs.write("uploadedResumePage", tabId, pageKey);

async function pageKeyOf(tabId: number): Promise<string> {
  try {
    const url = new URL((await chrome.tabs.get(tabId)).url ?? "");
    return url.origin + url.pathname;
  } catch {
    return "";
  }
}

/** Puts a generated PDF into the page's cover letter or resume upload field (a plain Fill skips the cover letter field on purpose). */
export async function attachFile(tabId: number, file: { name: string; base64: string; mimeType: string }, kind: "cover letter" | "resume"): Promise<void> {
  const fileFields = (await scanAllFrames(tabId)).filter((candidate) => candidate.kind === "file");
  const candidates = fileFields.filter(kind === "resume" ? mapping.isResumeField : mapping.isCoverLetterField);
  const field = (kind === "resume" && candidates.find((candidate) => /resume|\bcv\b/i.test(`${candidate.label} ${candidate.name}`))) || candidates[0];
  if (!field) throw new Error(`No ${kind} upload field found on this page.`);
  const fill: FieldFill = { id: field.id, frameId: field.frameId, value: file.name, source: "user" };
  const [result] = (await sendToFrame(tabId, field.frameId, { type: "fillFields", fills: [fill], resumeFile: file })) ?? [];
  if (!result?.ok) throw new Error(result?.error || "The page did not accept the file.");
  if (kind === "resume") await markResumeUploaded(tabId, await pageKeyOf(tabId));
}

/** scan all frames → deterministic map → answer bank → AI for leftovers → fill one by one → point at what is left → report. */
export async function run(
  tabId: number,
  job: JobPosting | null,
  options: { useAi: boolean; includeAccount: boolean; onProgress?: (phase: string) => void },
): Promise<FillReport> {
  const reportProgress = options.onProgress ?? (() => {});
  reportProgress("Scanning the form…");
  await clearHighlights(tabId);
  const fields = await scanAllFrames(tabId);
  reportProgress(fields.length ? `Matching your profile to ${fields.length} field${fields.length === 1 ? "" : "s"}…` : "No fields found on this step yet…");
  const [profile, resume, answers, settings] = await Promise.all([storage.get("profile"), storage.get("resume"), storage.get("answers"), storage.get("settings")]);

  const fills = mapping.map(fields, profile, answers, resume, options.includeAccount ? settings.account : undefined);
  const filledKeys = new Set(fills.map(keyOf));
  const leftovers = fields.filter((field) => !filledKeys.has(keyOf(field)) && needsAnswer(field) && !learning.isUserDecision(field));
  if (options.useAi && leftovers.length) reportProgress(`Asking AI for ${leftovers.length} remaining question${leftovers.length === 1 ? "" : "s"}… filling starts right after.`);
  const ai = options.useAi ? await askAi(leftovers, { profile, resume, job, answers }) : { fills: [], failed: false };
  const fieldOrder = new Map(fields.map((field, index) => [keyOf(field), index]));
  const pageKey = await pageKeyOf(tabId);
  const hasResumeUploaded = (await uploadedPage(tabId)) === pageKey;
  const allFills = [...fills, ...ai.fills]
    .filter((fill) => !(hasResumeUploaded && fill.source === "resume"))
    .sort((a, b) => fieldOrder.get(keyOf(a))! - fieldOrder.get(keyOf(b))!);

  reportProgress(allFills.length ? `Filling ${allFills.length} field${allFills.length === 1 ? "" : "s"}…` : "Nothing to fill on this step.");
  const results = await sendFills(tabId, allFills, resume);
  if (allFills.some((fill) => fill.source === "resume" && results.get(keyOf(fill))?.ok)) await markResumeUploaded(tabId, pageKey);
  const unknown = unknownFields(fields, results);
  await pointAtUnknown(tabId, unknown);
  await logMisses(tabId, unknown, allFills, results);
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
  return { items, filledCount, needsReviewCount, fieldCount: fields.length };
}

/** Re-apply user-edited values (source "user"), optionally saving them to the answer bank. `items` are the report rows being edited, so the log can say what we had put there. */
export async function apply(tabId: number, fills: FieldFill[], saveToAnswerBank: boolean, fields: FieldDescriptor[], items: FillReportItem[] = []): Promise<FillResult[]> {
  const resume = fills.some((fill) => fill.source === "resume") ? await storage.get("resume") : null;
  const results = await sendFills(tabId, fills, resume);
  await logPanelEdits(tabId, fills, items);
  if (saveToAnswerBank) await saveAnswers(fills, fields);
  return fills.flatMap((fill) => results.get(keyOf(fill)) ?? []);
}

async function logPanelEdits(tabId: number, fills: FieldFill[], items: FillReportItem[]): Promise<void> {
  const itemByKey = new Map(items.map((item) => [keyOf(item.field), item]));
  const entries = fills.flatMap((fill) => {
    const item = itemByKey.get(keyOf(fill));
    if (!item || !learning.isLoggable(item.field)) return [];
    const source = item.fill?.source ?? "none";
    return [learning.entryOf(item.field, source === "none" ? "learned" : "edited", source, item.fill?.value ?? "", fill.value)];
  });
  await learning.log(await hostOf(tabId), entries);
}

async function saveAnswers(fills: FieldFill[], fields: FieldDescriptor[]): Promise<void> {
  const fieldByKey = new Map(fields.map((field) => [keyOf(field), field]));
  const edited = fills.flatMap((fill) => {
    const field = fieldByKey.get(keyOf(fill));
    return field && fill.source === "user" ? [{ field, value: fill.value }] : [];
  });
  await learning.rememberAnswers(edited);
}
