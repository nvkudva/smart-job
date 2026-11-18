import { useEffect, useRef, useState } from "preact/hooks";
import type { JobAnalysis, JobStatus, TrackedJob } from "../../types.ts";
import { SavedResumes } from "../documents/savedResumes.tsx";
import { Button, Card } from "../shared/controls.tsx";
import { ScoreRing } from "../job/analysisView.tsx";
import { Icon } from "../shared/icons.tsx";
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
      <div class="note-body stack tight">
        <p class="small preline">{text}</p>
        <Button onClick={() => void navigator.clipboard.writeText(text)}>Copy</Button>
      </div>
    </details>
  );
}

/** What is already done for this application, so a half-finished one is easy to pick up. */
function Progress({ entry, hasResume }: { entry: TrackedJob; hasResume: boolean }) {
  const appliedOn = entry.appliedAt ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(entry.appliedAt) : "";
  const steps = [
    ["Cover letter", !!entry.coverLetter],
    ["Resume", hasResume],
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

/** The analysis the Analysis tab would show: the tracker's copy or the cached one, whichever is newer, so a score is never lost. */
function latestAnalysis(entry: TrackedJob, cached: JobAnalysis | undefined): JobAnalysis | null {
  if (!entry.analysis || !cached) return entry.analysis ?? cached ?? null;
  return cached.analyzedAt > entry.analysis.analyzedAt ? cached : entry.analysis;
}

function ResumeNote({ jobId }: { jobId: string }) {
  return (
    <details class="block">
      <summary class="small">Resume</summary>
      <div class="note-body">
        <SavedResumes jobId={jobId} showTitle={false} />
      </div>
    </details>
  );
}

function TrackerCard({ entry }: { entry: TrackedJob }) {
  const { job } = entry;
  const analysis = latestAnalysis(entry, useStored("analyses")?.[job.id]);
  const hasResume = !!useStored("tailoredResumes")?.some((resume) => resume.jobId === job.id);
  const [isNoteOpen, setIsNoteOpen] = useState(!!entry.notes);
  const salary = formatSalary(analysis?.salary ?? null) || job.salaryText;
  const setStatus = (status: JobStatus) => void trackedJobs.track(job, { status, ...(status === "applied" && !entry.appliedAt && { appliedAt: Date.now() }) });
  return (
    <section class="card tracker-card">
      <div class="tracker-head">
        <div>
          <div class="job-title small-title">{job.title}</div>
          <div class="muted small">
            {[job.company, job.location].filter(Boolean).join(" · ")}
            {salary && <>{job.company || job.location ? " · " : ""}<span class="nowrap">{salary}</span></>}
          </div>
        </div>
        <div class="tracker-side">
          <label class="tracker-status">
            <select class="status-pill" data-status={entry.status} aria-label="Progress" title="Change progress" value={entry.status} onChange={(event) => setStatus(event.currentTarget.value as JobStatus)}>
              {statuses.map((status) => (
                <option value={status}>{status}</option>
              ))}
            </select>
          </label>
          {analysis && <ScoreRing score={analysis.matchScore} />}
        </div>
      </div>
      <Progress entry={entry} hasResume={hasResume} />
      <CoverLetterNote text={entry.coverLetter} />
      {hasResume && <ResumeNote jobId={job.id} />}
      {isNoteOpen && <NotesField entry={entry} />}
      <div class="tracker-foot small">
        <div class="tracker-links">
        <a href={job.url} target="_blank" rel="noreferrer">
          Posting <Icon name="External" />
        </a>
        {entry.portalUrl && (
          <a href={entry.portalUrl} target="_blank" rel="noreferrer" title={`Log in here to follow your application${entry.accountEmail ? ` with ${entry.accountEmail}` : ""}`}>
            Portal <Icon name="External" />
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
        </div>
        <span class="tracker-actions">
          {entry.status !== "rejected" && (
            <button type="button" class="icon-btn primary" aria-label="Continue" title="Continue: open the job tab to write a cover letter, tailor your resume or fill the form" onClick={() => void reopenJob.open(entry)}>
              <Icon name="Continue" />
            </button>
          )}
          <button type="button" class="icon-btn danger-text" aria-label="Delete" title="Remove from the tracker" onClick={() => confirm(`Remove "${job.title}" from the tracker?`) && void trackedJobs.untrack(job.id)}>
            <Icon name="Trash" />
          </button>
        </span>
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
