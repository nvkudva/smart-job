import * as storage from "../../storage.ts";
import type { JobPosting, TailoredResume } from "../../types.ts";

const maxSaved = 100;

/** "Acme - Senior Engineer - Resume (13 Nov 2026)": says which job it was made for, in the viewer's date format. */
function nameFor(job: JobPosting, at: number): string {
  const date = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(at);
  const label = [job.company, job.title].filter(Boolean).join(" - ") || "Job";
  return `${label} - Resume (${date})`;
}

type NewResume = Pick<TailoredResume, "fileName" | "pdfBase64" | "markdown" | "changeCount">;

/** Saves under a readable name; passing the previous id replaces it so Regenerate does not pile up copies. */
export async function save(job: JobPosting, resume: NewResume, replaceId?: string): Promise<string> {
  const createdAt = Date.now();
  const id = `${job.id}:${createdAt}`;
  const record: TailoredResume = { ...resume, id, jobId: job.id, name: nameFor(job, createdAt), createdAt };
  await storage.update("tailoredResumes", (saved) => [record, ...saved.filter((entry) => entry.id !== replaceId)].slice(0, maxSaved));
  return id;
}

export function updateMarkdown(id: string, markdown: string): Promise<unknown> {
  return storage.update("tailoredResumes", (saved) => saved.map((entry) => (entry.id === id ? { ...entry, markdown } : entry)));
}

export function remove(id: string): Promise<unknown> {
  return storage.update("tailoredResumes", (saved) => saved.filter((entry) => entry.id !== id));
}
