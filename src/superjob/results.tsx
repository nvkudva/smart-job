import { useEffect, useRef, useState } from "preact/hooks";
import { Button } from "../panel/shared/controls.tsx";
import { useStored } from "../panel/shared/useStored.ts";
import type { JobPosting } from "../types.ts";
import { JobDetail } from "./jobDetail.tsx";
import { JobList, scoreFor } from "./jobList.tsx";
import type { FoundJob } from "./jobSources.ts";
import * as posting from "./posting.ts";
import * as selection from "./selection.ts";

/** Arrow-key browsing must not open a background tab for every job it passes. */
const loadDelayMs = 400;

export interface ChosenJob {
  selected: FoundJob | undefined;
  openedIds: ReadonlySet<string>;
  loaded: JobPosting | undefined;
  windowId: number | undefined;
  select: (id: string) => void;
}

function useCurrentTab(): chrome.tabs.Tab | undefined {
  const [tab, setTab] = useState<chrome.tabs.Tab>();
  useEffect(() => {
    void chrome.tabs.getCurrent().then(setTab);
  }, []);
  return tab;
}

/** Loads the selected posting after a short pause and tells the side panel; a load for a job no longer selected is cached but never published. */
function usePostings(selected: FoundJob | undefined, tabId: number | undefined): Record<string, JobPosting> {
  const [postings, setPostings] = useState<Record<string, JobPosting>>({});
  const cache = useRef(postings);
  cache.current = postings;
  useEffect(() => {
    if (tabId === undefined) return;
    const publish = (job: JobPosting | null, isLoading: boolean) => void selection.publish(tabId, { job, isLoading });
    if (!selected) return publish(null, false);
    const cached = cache.current[selected.id];
    if (cached) return publish(cached, false);
    publish(null, true);
    let isCurrent = true;
    const timer = setTimeout(async () => {
      const loaded = await posting.load(selected);
      setPostings((current) => ({ ...current, [selected.id]: loaded }));
      if (isCurrent) publish(loaded, false);
    }, loadDelayMs);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [selected?.id, tabId]);
  return postings;
}

/** Owns which job is shown and what the side panel is told about it; also runs for the home state so the panel never shows a stale job. */
export function useChosenJob(jobs: FoundJob[]): ChosenJob {
  const tab = useCurrentTab();
  const [selectedId, setSelectedId] = useState("");
  const [openedIds, setOpenedIds] = useState<ReadonlySet<string>>(new Set());
  const selected = jobs.find((job) => job.id === selectedId) ?? jobs[0];
  const postings = usePostings(selected, tab?.id);
  const loaded = selected && postings[selected.id];
  useEffect(() => {
    if (selected) setOpenedIds((current) => new Set(current).add(selected.id));
  }, [selected?.id]);
  return { selected, openedIds, loaded, windowId: tab?.windowId, select: setSelectedId };
}

interface ResultsProps {
  jobs: FoundJob[];
  chosen: ChosenJob;
  isLoading: boolean;
  onLoadMore: (() => void) | undefined;
}

function ListNote({ isLoading }: { isLoading: boolean }) {
  if (isLoading) return null;
  return <p class="muted sj-note">No jobs from the portals you have switched on. Switch a portal back on above.</p>;
}

export function Results({ jobs, chosen, isLoading, onLoadMore }: ResultsProps) {
  const analyses = useStored("analyses");
  const tracked = useStored("jobs");
  const stored = { analyses: analyses ?? {}, tracked: tracked ?? {} };
  const { selected } = chosen;
  const selectedId = selected ? posting.idFor(selected) : "";
  return (
    <>
      <section class="sj-list" aria-label="Job list">
        <JobList jobs={jobs} selectedId={selected?.id ?? ""} openedIds={chosen.openedIds} stored={stored} isLoading={isLoading} onSelect={chosen.select} />
        {!jobs.length && <ListNote isLoading={isLoading} />}
        {onLoadMore && (
          <div class="sj-more">
            <Button onClick={onLoadMore}>Load more</Button>
          </div>
        )}
      </section>
      <section class="sj-detail" aria-label="Job details">
        {selected ? (
          <JobDetail key={selected.id} job={selected} loaded={chosen.loaded} tracked={stored.tracked[chosen.loaded?.id ?? selectedId]} windowId={chosen.windowId} score={scoreFor(selectedId, stored)} />
        ) : (
          <p class="muted sj-empty">{isLoading ? "Searching the portals…" : "Select a job to see its details."}</p>
        )}
      </section>
    </>
  );
}
