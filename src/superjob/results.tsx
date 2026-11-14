import { useEffect, useState } from "preact/hooks";
import * as normalize from "../ai/normalize.ts";
import * as aiClient from "../panel/shared/aiClient.ts";
import { Spinner } from "../panel/shared/controls.tsx";
import type { FoundJob } from "./jobSources.ts";
import * as jobSources from "./jobSources.ts";
import * as summary from "./summary.ts";

const viewerSandbox = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";
const maxFallbackChars = 1200;

interface Summary {
  isLoading: boolean;
  bullets: string[];
  /** raw description or snippet, shown when the model gave no bullets */
  text: string;
}

async function loadSummary(job: FoundJob): Promise<Summary> {
  const description = await jobSources.describe(job).catch(() => "");
  const text = description.trim() || job.snippet;
  if (!text) return { isLoading: false, bullets: [], text: "" };
  const fallback = normalize.truncate(normalize.compact(text), maxFallbackChars);
  try {
    const bullets = await aiClient.withClient((client) => summary.summarize(client, job, text));
    return { isLoading: false, bullets, text: fallback };
  } catch {
    return { isLoading: false, bullets: [], text: fallback };
  }
}

function useSummaries(job: FoundJob | undefined): Summary | undefined {
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  useEffect(() => {
    if (!job || summaries[job.id]) return;
    const id = job.id;
    setSummaries((current) => ({ ...current, [id]: { isLoading: true, bullets: [], text: "" } }));
    void loadSummary(job).then((loaded) => setSummaries((current) => ({ ...current, [id]: loaded })));
  }, [job?.id]);
  return job && summaries[job.id];
}

function JobCard({ job, isSelected, onSelect }: { job: FoundJob; isSelected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button type="button" class="sj-card" aria-current={isSelected ? "true" : undefined} onClick={onSelect}>
        <strong class="sj-card-title">{job.title}</strong>
        <span>{job.company}</span>
        <span class="muted small">{[job.location, job.posted].filter(Boolean).join(" · ")}</span>
        {job.salary && <span class="small">{job.salary}</span>}
        <span class="badge">{job.source}</span>
      </button>
    </li>
  );
}

function JobList({ jobs, selectedId, onSelect }: { jobs: FoundJob[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <ul class="sj-cards" aria-label="Jobs">
      {jobs.map((job) => (
        <JobCard job={job} isSelected={job.id === selectedId} onSelect={() => onSelect(job.id)} />
      ))}
    </ul>
  );
}

function SummaryBody({ loaded }: { loaded: Summary | undefined }) {
  if (!loaded || loaded.isLoading) {
    return (
      <p class="muted">
        <Spinner /> Summarising…
      </p>
    );
  }
  if (loaded.bullets.length) {
    return (
      <ul class="sj-bullets">
        {loaded.bullets.map((bullet) => (
          <li>{bullet}</li>
        ))}
      </ul>
    );
  }
  return <p class="sj-fallback muted">{loaded.text || "No description available for this listing."}</p>;
}

function ListingViewer({ job, onBack }: { job: FoundJob; onBack: () => void }) {
  return (
    <div class="sj-viewer">
      <div class="sj-viewer-bar">
        <button type="button" class="btn" onClick={onBack}>
          Back to summary
        </button>
        <a class="btn primary" href={job.url} target="_blank" rel="noreferrer">
          Open in new tab ↗
        </a>
      </div>
      <iframe class="sj-frame" src={job.url} sandbox={viewerSandbox} referrerpolicy="no-referrer" title={`${job.title} listing`} />
    </div>
  );
}

function JobDetail({ job, loaded }: { job: FoundJob; loaded: Summary | undefined }) {
  const [isViewing, setIsViewing] = useState(false);
  if (isViewing) return <ListingViewer job={job} onBack={() => setIsViewing(false)} />;
  return (
    <article class="sj-detail-body">
      <h2>{job.title}</h2>
      <p>{job.company}</p>
      <p class="muted small">{[job.location, job.salary, job.posted].filter(Boolean).join(" · ")}</p>
      <p>
        <span class="badge">{job.source}</span>
      </p>
      <a
        class="sj-original"
        href={job.url}
        onClick={(event) => {
          event.preventDefault();
          setIsViewing(true);
        }}
      >
        Original listing: {job.url}
      </a>
      <h3>Summary</h3>
      <SummaryBody loaded={loaded} />
    </article>
  );
}

export function Results({ jobs }: { jobs: FoundJob[] }) {
  const [selectedId, setSelectedId] = useState("");
  const selected = jobs.find((job) => job.id === selectedId) ?? jobs[0];
  const loaded = useSummaries(selected);
  return (
    <>
      <section class="sj-list" aria-label="Job list">
        <JobList jobs={jobs} selectedId={selected?.id ?? ""} onSelect={setSelectedId} />
      </section>
      <section class="sj-detail" aria-label="Job details">
        {selected ? <JobDetail key={selected.id} job={selected} loaded={loaded} /> : <p class="muted sj-empty">Select a job to see its summary.</p>}
      </section>
    </>
  );
}
