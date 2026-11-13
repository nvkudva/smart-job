import * as storage from "../../storage.ts";
import type { JobAnalysis, JobPosting, TrackedJob } from "../../types.ts";

/** Create or update the tracker entry for a job. New entries start as "saved" with any cached analysis. */
export async function track(job: JobPosting, patch: Partial<Omit<TrackedJob, "job">> = {}): Promise<void> {
  const cachedAnalysis = (await storage.get("analyses"))[job.id] ?? null;
  await storage.update("jobs", (jobs) => {
    const now = Date.now();
    const created: TrackedJob = { job, analysis: cachedAnalysis, status: "saved", notes: "", savedAt: now, updatedAt: now, coverLetter: "" };
    return { ...jobs, [job.id]: { ...(jobs[job.id] ?? created), ...patch, updatedAt: now } };
  });
}

export async function untrack(jobId: string): Promise<void> {
  await storage.update("jobs", (jobs) => Object.fromEntries(Object.entries(jobs).filter(([id]) => id !== jobId)));
}

const maxCachedAnalyses = 200;

/** Newest analyses win; the cache would otherwise grow with every job page ever opened. */
function newest(analyses: Record<string, JobAnalysis>): Record<string, JobAnalysis> {
  const entries = Object.entries(analyses);
  if (entries.length <= maxCachedAnalyses) return analyses;
  entries.sort(([, first], [, second]) => second.analyzedAt - first.analyzedAt);
  return Object.fromEntries(entries.slice(0, maxCachedAnalyses));
}

export async function saveAnalysis(job: JobPosting, analysis: JobAnalysis): Promise<void> {
  await storage.update("analyses", (analyses) => newest({ ...analyses, [job.id]: analysis }));
  await storage.update("jobs", (jobs) => {
    const existing = jobs[job.id];
    return existing ? { ...jobs, [job.id]: { ...existing, analysis, updatedAt: Date.now() } } : jobs;
  });
}
