import type { TailoredResume, TrackedJob } from "../../types.ts";
import { formatSalary } from "../job/salary.tsx";

/** A leading = + - @ tab or CR would make Excel/Sheets run the cell as a formula, so those get a ' in front. */
const csvCell = (value: string | number) => {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function build(entries: TrackedJob[], resumes: TailoredResume[]): string {
  const header = ["Title", "Company", "Location", "Status", "Match", "Salary", "Posting URL", "Application portal", "Login email", "Applied", "Tailored resumes", "Cover letter", "Notes", "Saved"];
  const rows = entries.map((entry) => [
    entry.job.title,
    entry.job.company,
    entry.job.location,
    entry.status,
    entry.analysis?.matchScore ?? "",
    formatSalary(entry.analysis?.salary ?? null) || entry.job.salaryText,
    entry.job.url,
    entry.portalUrl ?? "",
    entry.accountEmail ?? "",
    entry.appliedAt ? new Date(entry.appliedAt).toISOString() : "",
    resumes.filter((resume) => resume.jobId === entry.job.id).map((resume) => resume.name).join("; "),
    entry.coverLetter,
    entry.notes,
    new Date(entry.savedAt).toISOString(),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}
