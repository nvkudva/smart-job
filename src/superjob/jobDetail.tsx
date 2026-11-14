import { useState } from "preact/hooks";
import { canUnshortlist } from "../panel/job/analysisTab.tsx";
import * as trackedJobs from "../panel/job/trackedJobs.ts";
import { Button, Spinner } from "../panel/shared/controls.tsx";
import type { JobPosting, TrackedJob } from "../types.ts";
import { Logo, ScoreBadge, StarIcon } from "./jobList.tsx";
import type { FoundJob } from "./jobSources.ts";

const viewerSandbox = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";

export interface Summary {
  isLoading: boolean;
  bullets: string[];
}

type View = "summary" | "original";

/** posting.load falls back to the card snippet when no full text could be read. */
export function hasFullDescription(job: FoundJob, loaded: JobPosting): boolean {
  const text = loaded.description.trim();
  return text !== "" && text !== job.snippet.trim();
}

function Loading({ label }: { label: string }) {
  return (
    <p class="muted">
      <Spinner /> {label}
    </p>
  );
}

function Paragraphs({ text }: { text: string }) {
  const paragraphs = text.split(/\n\s*\n/).filter((paragraph) => paragraph.trim());
  return (
    <div class="sj-prose">
      {paragraphs.map((paragraph) => (
        <p>{paragraph.trim()}</p>
      ))}
    </div>
  );
}

function SnippetOnly({ job }: { job: FoundJob }) {
  return (
    <>
      <p class="sj-notice">The full description could not be loaded. Open the original to read it.</p>
      {job.snippet && <Paragraphs text={job.snippet} />}
    </>
  );
}

function SummaryView({ job, loaded, summary }: { job: FoundJob; loaded: JobPosting | undefined; summary: Summary | undefined }) {
  if (!loaded) return <Loading label="Loading the description…" />;
  if (!hasFullDescription(job, loaded)) return <SnippetOnly job={job} />;
  return (
    <>
      {(!summary || summary.isLoading) && <Loading label="Summarising…" />}
      {!!summary?.bullets.length && (
        <ul class="sj-bullets">
          {summary.bullets.map((bullet) => (
            <li>{bullet}</li>
          ))}
        </ul>
      )}
      <h3 class="sj-about">About the job</h3>
      <Paragraphs text={loaded.description} />
    </>
  );
}

function Meta({ job }: { job: FoundJob }) {
  return (
    <p class="sj-meta lead">
      {job.location && <span>{job.location}</span>}
      {job.salary && <span class="sj-salary">{job.salary}</span>}
      {job.posted && <span>{job.posted}</span>}
      <span>{job.source}</span>
    </p>
  );
}

interface ActionsProps {
  job: FoundJob;
  loaded: JobPosting | undefined;
  tracked: TrackedJob | undefined;
  windowId: number | undefined;
}

function Actions({ job, loaded, tracked, windowId }: ActionsProps) {
  const [hasPanelHint, setHasPanelHint] = useState(false);
  const toggleSaved = async () => {
    if (!loaded) return;
    if (!tracked) await trackedJobs.track(loaded);
    else if (canUnshortlist(tracked)) await trackedJobs.untrack(loaded.id);
  };
  const openPanel = async () => {
    try {
      await chrome.sidePanel.open({ windowId: windowId! });
      setHasPanelHint(false);
    } catch {
      setHasPanelHint(true);
    }
  };
  return (
    <div class="sj-actions">
      <div class="sj-buttons">
        <Button kind="primary" onClick={() => void chrome.tabs.create({ url: job.url })}>
          {job.isSearchUrl ? `Open on ${job.source}` : "Apply"}
        </Button>
        <Button disabled={!loaded} onClick={() => void toggleSaved()} title={tracked && !canUnshortlist(tracked) ? "Change status or remove in Tracker" : undefined}>
          <StarIcon />
          {tracked ? "Saved" : "Save"}
        </Button>
        <Button disabled={!loaded} onClick={() => void openPanel()}>
          Analyze match
        </Button>
      </div>
      {hasPanelHint && <p class="small muted">Could not open the side panel. Click the SmartJob icon in the toolbar.</p>}
    </div>
  );
}

function Tabs({ view, labels, onView }: { view: View; labels: Record<View, string>; onView: (view: View) => void }) {
  const views = Object.keys(labels) as View[];
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = views[(views.indexOf(view) + step + views.length) % views.length]!;
    onView(next);
    (event.currentTarget as HTMLElement).querySelector<HTMLElement>(`#sj-tab-${next}`)?.focus();
  };
  return (
    <div class="sj-tabs" role="tablist" aria-label="Job views" onKeyDown={onKeyDown}>
      {views.map((candidate) => (
        <button type="button" role="tab" id={`sj-tab-${candidate}`} aria-selected={candidate === view} aria-controls="sj-view" tabIndex={candidate === view ? 0 : -1} onClick={() => onView(candidate)}>
          {labels[candidate]}
        </button>
      ))}
    </div>
  );
}

interface JobDetailProps extends ActionsProps {
  score: number | null;
  summary: Summary | undefined;
}

export function JobDetail({ job, loaded, tracked, windowId, score, summary }: JobDetailProps) {
  const [view, setView] = useState<View>("summary");
  const labels: Record<View, string> = { summary: "Summary", original: job.isSearchUrl ? `${job.source} search` : "Original" };
  return (
    <article class="sj-detail-pane">
      <header class="sj-detail-head">
        <div class="sj-identity">
          <Logo job={job} size="head" />
          <div class="sj-identity-text">
            <h2>{job.title}</h2>
            <p class="sj-company">{job.company}</p>
          </div>
          {score !== null && <ScoreBadge score={score} />}
        </div>
        <Meta job={job} />
        <div class="sj-toolbar">
          <Tabs view={view} labels={labels} onView={setView} />
          <Actions job={job} loaded={loaded} tracked={tracked} windowId={windowId} />
        </div>
      </header>
      <div class={`sj-view${view === "original" ? " is-frame" : ""}`} id="sj-view" role="tabpanel" aria-labelledby={`sj-tab-${view}`}>
        {view === "summary" && <SummaryView job={job} loaded={loaded} summary={summary} />}
        {view === "original" && <iframe class="sj-frame" src={job.url} sandbox={viewerSandbox} referrerpolicy="no-referrer" title={`${job.title} listing`} />}
      </div>
    </article>
  );
}
