import { useEffect, useRef, useState } from "preact/hooks";
import type { JobStatus, TrackedJob } from "../types.ts";
import { Button, Card, Choice } from "./controls.tsx";
import * as download from "./download.ts";
import { formatSalary } from "./salary.tsx";
import * as trackedJobs from "./trackedJobs.ts";
import { useStored } from "./useStored.ts";

const statuses: JobStatus[] = ["saved", "applied", "interview", "offer", "rejected"];
const notesSaveDelayMs = 500;

const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

function toCsv(entries: TrackedJob[]): string {
  const header = ["Title", "Company", "Location", "Status", "Match", "Salary", "URL", "Notes", "Saved"];
  const rows = entries.map((entry) => [
    entry.job.title,
    entry.job.company,
    entry.job.location,
    entry.status,
    entry.analysis?.matchScore ?? "",
    formatSalary(entry.analysis?.salary ?? null) || entry.job.salaryText,
    entry.job.url,
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
      <Choice label="Status" value={entry.status} options={statuses} onValue={(status) => void trackedJobs.track(job, { status: status as JobStatus })} />
      <NotesField entry={entry} />
      <div class="row between">
        <a href={job.url} target="_blank" rel="noreferrer">
          Open posting
        </a>
        <Button kind="danger" onClick={() => confirm(`Remove "${job.title}" from the tracker?`) && void trackedJobs.untrack(job.id)}>
          Delete
        </Button>
      </div>
    </Card>
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
      <Card title="Tracker">
        <p class="muted">No jobs yet. Shortlist a job from the Job tab and it will appear here.</p>
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
        <Button onClick={() => download.save("smartjob-tracker.csv", toCsv(entries), "text/csv")}>Export CSV</Button>
      </div>
      {visible.map((entry) => (
        <TrackerCard key={entry.job.id} entry={entry} />
      ))}
    </div>
  );
}
