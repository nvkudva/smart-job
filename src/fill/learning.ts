// What SmartJob learns from a fill: a capped log of misses, and answers the user typed for questions it could not answer.
import * as storage from "../storage.ts";
import type { AnswerBank, FieldDescriptor, FillLogEntry, FillSource } from "../types.ts";
import * as mapping from "./mapping.ts";

const MAX_LOG_ENTRIES = 500;
const MAX_LOGGED_OPTIONS = 12;
const MAX_SAVED_HINTS = 8;
const MIN_HINT_OVERLAP = 0.5;

// agreeing to terms, privacy policies or consent is the user's decision: never saved, never sent to the model
const CONSENT = /privacy (policy|notice)|terms (of|and) (use|service|conditions)|\bconsent\b|\bi agree\b/i;

export const isSingleCheckbox = (field: FieldDescriptor) => field.kind === "checkbox" && field.options.length < 2;

export const isUserDecision = (field: FieldDescriptor) => isSingleCheckbox(field) || CONSENT.test(`${field.label} ${field.options.join(" ")}`);

export function isLoggable(field: FieldDescriptor): boolean {
  return field.kind !== "file" && field.kind !== "password" && !isSingleCheckbox(field);
}

export function isBankable(field: FieldDescriptor): boolean {
  return isLoggable(field) && !!mapping.normalize(field.label) && !isUserDecision(field);
}

export function entryOf(field: FieldDescriptor, outcome: FillLogEntry["outcome"], source: FillLogEntry["source"], filled: string, final: string, error = ""): Omit<FillLogEntry, "at" | "host"> {
  const { label, kind, section, name, automationId } = field;
  return { outcome, label, kind, section, name, automationId, options: field.options.slice(0, MAX_LOGGED_OPTIONS), source, filled, final, error };
}

export async function log(host: string, entries: Omit<FillLogEntry, "at" | "host">[]): Promise<void> {
  if (!entries.length) return;
  const at = Date.now();
  await storage.update("fillLog", (current) => [...current, ...entries.map((entry) => ({ ...entry, at, host }))].slice(-MAX_LOG_ENTRIES));
}

export async function rememberAnswers(answers: { field: FieldDescriptor; value: string }[]): Promise<void> {
  const worthKeeping = answers.filter(({ field, value }) => isBankable(field) && value.trim());
  if (!worthKeeping.length) return;
  const now = Date.now();
  await storage.update("answers", (bank) => {
    const next = { ...bank };
    for (const { field, value } of worthKeeping) next[mapping.normalize(field.label)] = { question: field.label, answer: value, updatedAt: now };
    return next;
  });
}

const LOGIN_FIELD = /e ?mail|user ?name|user ?id|login/i;

/**
 * The user changed a field on the page. The log always gets it, and the new value is saved as the answer for that question, so the next form asks the same thing
 * and gets what the user chose (a saved answer is tried before the profile). The one exception is a login or email field the profile filled: that is
 * usually an account made for one site, and saving it would put it on every other form.
 */
export async function recordEdit(host: string, field: FieldDescriptor, source: FillSource | "none", filled: string, final: string): Promise<void> {
  if (!isLoggable(field)) return;
  await log(host, [entryOf(field, source === "none" ? "learned" : "edited", source, filled, final)]);
  const isLogin = field.kind === "email" || LOGIN_FIELD.test(field.label);
  if (source === "profile" && isLogin) return;
  await rememberAnswers([{ field, value: final }]);
}

function wordsOf(text: string): Set<string> {
  return new Set(mapping.normalize(text).split(" ").filter((word) => word.length > 2));
}

/** Saved answers to questions that share most words with these fields, offered to the model as examples of how this candidate answers. */
export function similarAnswers(bank: AnswerBank, fields: FieldDescriptor[]): { question: string; answer: string }[] {
  const saved = Object.values(bank).map((entry) => ({ entry, words: wordsOf(entry.question) }));
  const picked = new Map<string, { question: string; answer: string }>();
  for (const field of fields) {
    const words = wordsOf(field.label);
    if (!words.size || !isBankable(field)) continue;
    for (const { entry, words: savedWords } of saved) {
      const shared = [...words].filter((word) => savedWords.has(word)).length;
      if (shared / Math.max(words.size, savedWords.size) >= MIN_HINT_OVERLAP) picked.set(entry.question, { question: entry.question, answer: entry.answer });
    }
  }
  return [...picked.values()].slice(0, MAX_SAVED_HINTS);
}
