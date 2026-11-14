import { useState } from "preact/hooks";
import { ScoreRing } from "../panel/job/analysisView.tsx";
import type { JobAnalysis, TrackedJob } from "../types.ts";
import type { FoundJob } from "./jobSources.ts";
import * as posting from "./posting.ts";

export interface StoredJobs {
  analyses: Record<string, JobAnalysis>;
  tracked: Record<string, TrackedJob>;
}

export function scoreFor(id: string, stored: StoredJobs): number | null {
  const score = stored.analyses[id]?.matchScore ?? stored.tracked[id]?.analysis?.matchScore;
  return typeof score === "number" ? Math.round(score) : null;
}

export function filterByPortals(jobs: FoundJob[], hiddenPortals: ReadonlySet<string>): FoundJob[] {
  return jobs.filter((job) => !hiddenPortals.has(job.source));
}

function toneIndex(name: string): number {
  let sum = 0;
  for (const char of name) sum += char.codePointAt(0)!;
  return sum % 4;
}

export function Logo({ job, size }: { job: FoundJob; size: "row" }) {
  const [hasFailed, setHasFailed] = useState(false);
  const initial = (job.company.trim()[0] ?? "?").toUpperCase();
  if (!job.logoUrl || hasFailed) {
    return (
      <span class={`sj-logo ${size} tone-${toneIndex(job.company)}`} aria-hidden="true">
        {initial}
      </span>
    );
  }
  return <img class={`sj-logo ${size}`} src={job.logoUrl} alt="" loading="lazy" referrerpolicy="no-referrer" onError={() => setHasFailed(true)} />;
}

export function StarIcon() {
  return (
    <svg class="sj-star" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4-5.7-3.1-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z" />
    </svg>
  );
}

interface JobRowProps {
  job: FoundJob;
  isSelected: boolean;
  isOpened: boolean;
  score: number | null;
  isSaved: boolean;
  onSelect: () => void;
}

function JobRow({ job, isSelected, isOpened, score, isSaved, onSelect }: JobRowProps) {
  return (
    <li>
      <button type="button" class={`sj-row${isOpened ? " is-opened" : ""}`} tabIndex={isSelected ? 0 : -1} aria-current={isSelected ? "true" : undefined} onClick={onSelect}>
        <Logo job={job} size="row" />
        <span class="sj-row-main">
          <span class="sj-row-title">{job.title}</span>
          <span class="sj-row-company">{job.company}</span>
          <span class="sj-meta">
            {job.location && <span class="sj-loc">{job.location}</span>}
            {job.salary && <span class="sj-salary">{job.salary}</span>}
            {job.posted && <span>{job.posted}</span>}
            <span>{job.source}</span>
          </span>
        </span>
        <span class="sj-row-flags">
          {score !== null && <ScoreRing score={score} />}
          {isSaved && (
            <span class="sj-saved" title="Saved">
              <StarIcon />
              <span class="sr-only">Saved</span>
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function SkeletonRows() {
  const placeholders = [0, 1, 2, 3, 4, 5];
  return (
    <ul class="sj-rows" aria-hidden="true">
      {placeholders.map((placeholder) => (
        <li key={placeholder} class="sj-skeleton-row">
          <span class="sj-logo row sj-skel" />
          <span class="sj-row-main">
            <span class="sj-skel line wide" />
            <span class="sj-skel line" />
            <span class="sj-skel line narrow" />
          </span>
        </li>
      ))}
    </ul>
  );
}

interface JobListProps {
  jobs: FoundJob[];
  selectedId: string;
  openedIds: ReadonlySet<string>;
  stored: StoredJobs;
  isLoading: boolean;
  onSelect: (id: string) => void;
}

function moveSelection(event: KeyboardEvent, jobs: FoundJob[], selectedId: string, onSelect: (id: string) => void) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const current = jobs.findIndex((job) => job.id === selectedId);
  const next = Math.max(0, Math.min(jobs.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
  if (next === current) return;
  onSelect(jobs[next]!.id);
  const rows = (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(".sj-row");
  rows[next]?.focus();
}

export function JobList({ jobs, selectedId, openedIds, stored, isLoading, onSelect }: JobListProps) {
  if (!jobs.length && isLoading) return <SkeletonRows />;
  return (
    <ul class="sj-rows" aria-label="Jobs" onKeyDown={(event) => moveSelection(event, jobs, selectedId, onSelect)}>
      {jobs.map((job) => {
        const id = posting.idFor(job);
        return <JobRow key={job.id} job={job} isSelected={job.id === selectedId} isOpened={openedIds.has(job.id)} score={scoreFor(id, stored)} isSaved={id in stored.tracked} onSelect={() => onSelect(job.id)} />;
      })}
    </ul>
  );
}
