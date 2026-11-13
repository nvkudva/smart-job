import { useEffect, useRef, useState } from "preact/hooks";
import type { JobStatus, TailoredResume, TrackedJob } from "../../types.ts";
import { SavedResumes } from "../documents/savedResumes.tsx";
import { Button, Card, Choice } from "../shared/controls.tsx";
import * as download from "../shared/download.ts";
import { formatSalary } from "../job/salary.tsx";
import * as trackedJobs from "../job/trackedJobs.ts";
import { useStored } from "../shared/useStored.ts";

const statuses: JobStatus[] = ["saved", "applied", "interview", "offer", "rejected"];
const notesSaveDelayMs = 500;

const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

function toCsv(entries: TrackedJob[], resumes: TailoredResume[]): string {
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

function NotesField({ entry }: { entry: TrackedJob }) {
  const [notes, setNotes] = useState(entry.notes);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onInput = (value: string) => {
    setNotes(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void trackedJobs.track(entry.job, { notes: value }), notesSaveDelayMs);
  };
  return <textarea rows={2} placeholder="Notes" aria-label="Notes" value={notes} onInput={(event) => onInput(event.currentTarget.value)} />;
}

const siteNames: Record<string, string> = { linkedin: "LinkedIn", indeed: "Indeed", workday: "Workday", greenhouse: "Greenhouse", lever: "Lever", icims: "iCIMS", ashby: "Ashby" };

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function postingLabel(job: TrackedJob["job"]): string {
  return `Job posting on ${siteNames[job.source] ?? hostOf(job.url)}`;
}

function Links({ entry }: { entry: TrackedJob }) {
  return (
    <div class="stack tight">
      <a href={entry.job.url} target="_blank" rel="noreferrer">
        {postingLabel(entry.job)} ↗
      </a>
      {entry.portalUrl && (
        <div>
          <a href={entry.portalUrl} target="_blank" rel="noreferrer">
            Application portal: {hostOf(entry.portalUrl)} ↗
          </a>
          <div class="muted small">Log in here to follow your application{entry.accountEmail ? ` with ${entry.accountEmail}` : ""}.</div>
        </div>
      )}
    </div>
  );
}

function CoverLetterNote({ text }: { text: string }) {
  if (!text) return null;
  return (
    <details class="block">
      <summary class="small">Cover letter</summary>
      <p class="small preline">{text}</p>
      <Button onClick={() => void navigator.clipboard.writeText(text)}>Copy</Button>
    </details>
  );
}

function TrackerCard({ entry }: { entry: TrackedJob }) {
  const { job, analysis } = entry;
  const salary = formatSalary(analysis?.salary ?? null) || job.salaryText;
  return (
    <Card>
      <div class="row between">
        <div>
          <div class="job-title small-title">{job.title}</div>
          <div class="muted">{[job.company, job.location].filter(Boolean).join(" · ")}</div>
        </div>
        {analysis && <span class="badge score">{analysis.matchScore}</span>}
      </div>
      {salary && <div class="muted small">{salary}</div>}
      <Choice label="Status" value={entry.status} options={statuses} onValue={(status) => void trackedJobs.track(job, { status: status as JobStatus, ...(status === "applied" && !entry.appliedAt && { appliedAt: Date.now() }) })} />
      {entry.appliedAt && <div class="muted small">Applied {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(entry.appliedAt)}</div>}
      <Links entry={entry} />
      <SavedResumes jobId={job.id} />
      <CoverLetterNote text={entry.coverLetter} />
      <NotesField entry={entry} />
      <div class="row between">
        <span />
        <Button kind="danger" onClick={() => confirm(`Remove "${job.title}" from the tracker?`) && void trackedJobs.untrack(job.id)}>
          Delete
        </Button>
      </div>
    </Card>
  );
}

export function TrackerTab() {
  const jobs = useStored("jobs");
  const resumes = useStored("tailoredResumes");
  const [filter, setFilter] = useState<JobStatus | "all">("all");
  const entries = Object.values(jobs ?? {}).sort((a, b) => b.updatedAt - a.updatedAt);
  const visible = filter === "all" ? entries : entries.filter((entry) => entry.status === filter);
  const countOf = (status: JobStatus) => entries.filter((entry) => entry.status === status).length;

  if (entries.length === 0) {
    return (
      <Card title="Track">
        <p class="muted">No jobs yet. Shortlist or apply to a job from the Analysis tab and it will appear here.</p>
      </Card>
    );
  }
  return (
    <div class="stack">
      <div class="row wrap between">
        <div class="chips">
          <button type="button" class={`chip pick ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
            All {entries.length}
          </button>
          {statuses.map((status) => (
            <button type="button" class={`chip pick ${filter === status ? "active" : ""}`} onClick={() => setFilter(status)}>
              {status} {countOf(status)}
            </button>
          ))}
        </div>
        <Button onClick={() => download.save("smartjob-tracker.csv", toCsv(entries, resumes ?? []), "text/csv")}>Export CSV</Button>
      </div>
      {visible.map((entry) => (
        <TrackerCard key={entry.job.id} entry={entry} />
      ))}
    </div>
  );
}
