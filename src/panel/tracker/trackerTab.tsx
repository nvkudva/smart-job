import { useEffect, useRef, useState } from "preact/hooks";
import type { JobStatus, TrackedJob } from "../../types.ts";
import { SavedResumes } from "../documents/savedResumes.tsx";
import { Button, Card } from "../shared/controls.tsx";
import { formatSalary } from "../job/salary.tsx";
import * as trackedJobs from "../job/trackedJobs.ts";
import { useStored } from "../shared/useStored.ts";
import * as reopenJob from "./reopenJob.ts";

const statuses: JobStatus[] = ["saved", "applied", "interview", "offer", "rejected"];
const notesSaveDelayMs = 500;

function NotesField({ entry }: { entry: TrackedJob }) {
  const [notes, setNotes] = useState(entry.notes);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onInput = (value: string) => {
    setNotes(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void trackedJobs.track(entry.job, { notes: value }), notesSaveDelayMs);
  };
  return <textarea rows={2} placeholder="Notes" aria-label="Notes" value={notes} autoFocus={!entry.notes} onInput={(event) => onInput(event.currentTarget.value)} />;
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

/** What is already done for this application, so a half-finished one is easy to pick up. */
function Progress({ entry }: { entry: TrackedJob }) {
  const resumes = useStored("tailoredResumes");
  const appliedOn = entry.appliedAt ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(entry.appliedAt) : "";
  const steps = [
    ["Cover letter", !!entry.coverLetter],
    ["Resume", !!resumes?.some((resume) => resume.jobId === entry.job.id)],
    ["Form filled", !!entry.portalUrl],
    [appliedOn ? `Applied ${appliedOn}` : "Applied", !!entry.appliedAt],
  ] as const;
  return (
    <div class="progress small">
      {steps.map(([label, isDone]) => (
        <span key={label} class={isDone ? "ok-text" : "muted"}>
          {isDone ? "✓" : "○"} {label}
        </span>
      ))}
    </div>
  );
}

function TrackerCard({ entry }: { entry: TrackedJob }) {
  const { job, analysis } = entry;
  const [isNoteOpen, setIsNoteOpen] = useState(!!entry.notes);
  const salary = formatSalary(analysis?.salary ?? null) || job.salaryText;
  const setStatus = (status: JobStatus) => void trackedJobs.track(job, { status, ...(status === "applied" && !entry.appliedAt && { appliedAt: Date.now() }) });
  return (
    <section class="card tracker-card">
      <div class="row between top">
        <div>
          <div class="job-title small-title">{job.title}</div>
          <div class="muted small">{[job.company, job.location, salary].filter(Boolean).join(" · ")}</div>
        </div>
        {analysis && <span class="badge score">{analysis.matchScore}</span>}
      </div>
      <Progress entry={entry} />
      <div class="row between">
        <select class="status-pill" data-status={entry.status} aria-label="Status" title="Change status" value={entry.status} onChange={(event) => setStatus(event.currentTarget.value as JobStatus)}>
          {statuses.map((status) => (
            <option value={status}>{status}</option>
          ))}
        </select>
        {entry.status !== "rejected" && (
          <Button kind="primary" title="Open the job tab to write a cover letter, tailor your resume or fill the form" onClick={() => void reopenJob.open(entry)}>
            Continue
          </Button>
        )}
      </div>
      <SavedResumes jobId={job.id} />
      <CoverLetterNote text={entry.coverLetter} />
      {isNoteOpen && <NotesField entry={entry} />}
      <div class="tracker-foot small">
        <a href={job.url} target="_blank" rel="noreferrer">
          Posting ↗
        </a>
        {entry.portalUrl && (
          <a href={entry.portalUrl} target="_blank" rel="noreferrer" title={`Log in here to follow your application${entry.accountEmail ? ` with ${entry.accountEmail}` : ""}`}>
            Portal ↗
          </a>
        )}
        {!isNoteOpen && (
          <button type="button" class="link" onClick={() => setIsNoteOpen(true)}>
            + Note
          </button>
        )}
        {!entry.appliedAt && (
          <button type="button" class="link" onClick={() => setStatus("applied")}>
            Mark applied
          </button>
        )}
        <button type="button" class="link danger-text" onClick={() => confirm(`Remove "${job.title}" from the tracker?`) && void trackedJobs.untrack(job.id)}>
          Delete
        </button>
      </div>
    </section>
  );
}

export function TrackerTab() {
  const jobs = useStored("jobs");
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
      <div class="chips filter-row">
        <button type="button" class={`chip pick ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
          All {entries.length}
        </button>
        {statuses.map((status) => (
          <button type="button" class={`chip pick ${filter === status ? "active" : ""}`} onClick={() => setFilter(status)}>
            {status} {countOf(status)}
          </button>
        ))}
      </div>
      {visible.map((entry) => (
        <TrackerCard key={entry.job.id} entry={entry} />
      ))}
    </div>
  );
}
