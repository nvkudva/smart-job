import { useEffect, useState } from "preact/hooks";
import * as llm from "../../ai/llm.ts";
import type { CandidateContext } from "../../ai/tasks.ts";
import * as storage from "../../storage.ts";
import type { Settings } from "../../types.ts";

export type AiStatus = "unknown" | "ok" | "error";

let status: AiStatus = "unknown";
const listeners = new Set<(next: AiStatus) => void>();

export function report(next: AiStatus): void {
  status = next;
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

export interface AiContext {
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
    report("error");
    throw failure;
  }
}
