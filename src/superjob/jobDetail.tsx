import { useState } from "preact/hooks";
import { canUnshortlist } from "../panel/job/analysisTab.tsx";
import * as trackedJobs from "../panel/job/trackedJobs.ts";
import { Button } from "../panel/shared/controls.tsx";
import type { JobPosting, TrackedJob } from "../types.ts";
import { Logo, ScoreBadge, StarIcon } from "./jobList.tsx";
import type { FoundJob } from "./jobSources.ts";

const viewerSandbox = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";

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

interface JobDetailProps extends ActionsProps {
  score: number | null;
}

export function JobDetail({ job, loaded, tracked, windowId, score }: JobDetailProps) {
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
        <Actions job={job} loaded={loaded} tracked={tracked} windowId={windowId} />
      </header>
      <div class="sj-view">
        <iframe class="sj-frame" src={job.url} sandbox={viewerSandbox} referrerpolicy="no-referrer" title={`${job.title} listing`} />
      </div>
    </article>
  );
}
