import Anthropic from "@anthropic-ai/sdk";
import { useEffect, useState } from "preact/hooks";
import * as llm from "../../ai/llm.ts";
import type { CandidateContext } from "../../ai/tasks.ts";
import * as storage from "../../storage.ts";
import type { Settings } from "../../types.ts";

type AiStatus = "unknown" | "ok" | "error";

export const statusLabel: Record<AiStatus, string> = { unknown: "AI not checked yet", ok: "AI reachable", error: "AI error" };

let status: AiStatus = "unknown";
const listeners = new Set<(next: AiStatus) => void>();

export function report(next: AiStatus): void {
  status = next;
  if (next === "ok") setRateLimited(false);
  for (const listener of listeners) listener(next);
}

export function useStatus(): AiStatus {
  const [current, setCurrent] = useState(status);
  useEffect(() => {
    listeners.add(setCurrent);
    return () => void listeners.delete(setCurrent);
  }, []);
  return current;
}

/** `LLM 429:` is what llm.ts writes for OpenAI-style endpoints; Anthropic's SDK throws its own error class. */
function isRateLimitError(failure: unknown): boolean {
  return failure instanceof Anthropic.RateLimitError || /^(Error: )?LLM 429:/.test(String(failure));
}

let isRateLimited = false;
const rateLimitListeners = new Set<(next: boolean) => void>();

function setRateLimited(next: boolean): void {
  isRateLimited = next;
  for (const listener of rateLimitListeners) listener(next);
}

/** Cards hide their own AI error while the header banner already explains it; their normal buttons stay as the way to retry. */
export function useCardError(error: string): string {
  return useStatus() === "error" ? "" : error;
}

/** Pings the saved provider and updates the status, so the banner clears once the AI is back. */
export async function check(): Promise<void> {
  const settings = await storage.get("settings");
  try {
    await llm.create(settings.provider).chat({ system: "Reply with the single word OK.", user: "ping", maxTokens: 16 });
    report("ok");
  } catch {
    report("error");
  }
}

/** True after a provider answered "rate limited", until the next successful AI call. */
export function useRateLimited(): boolean {
  const [current, setCurrent] = useState(isRateLimited);
  useEffect(() => {
    rateLimitListeners.add(setCurrent);
    return () => void rateLimitListeners.delete(setCurrent);
  }, []);
  return current;
}

interface AiContext {
  client: llm.LlmClient;
  candidate: CandidateContext;
  settings: Settings;
}

/** Loads provider + candidate from storage, runs the task, and records provider health for the header dot. */
export async function run<T>(task: (context: AiContext) => Promise<T>): Promise<T> {
  const [settings, profile, resume] = await Promise.all([storage.get("settings"), storage.get("profile"), storage.get("resume")]);
  if (!resume) throw new Error("Add your resume in Settings first.");
  const context = { client: llm.create(settings.provider), candidate: { profile, resumeText: resume.text }, settings };
  try {
    const result = await task(context);
    report("ok");
    return result;
  } catch (failure) {
    // the provider answered fine, the request was just too big: keep the header calm and let the card show how to fix it
    if (failure instanceof llm.TokenLimitError) {
      report("ok");
      throw failure;
    }
    report("error");
    if (isRateLimitError(failure)) setRateLimited(true);
    throw failure;
  }
}
