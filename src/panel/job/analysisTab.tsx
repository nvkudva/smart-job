import type { ActiveJob } from "./activeTab.ts";
import { AnalysisView } from "./analysisView.tsx";
import { Button, Card, ErrorNote, Spinner } from "../shared/controls.tsx";
import { SalarySection } from "./salary.tsx";
import * as trackedJobs from "./trackedJobs.ts";
import { useAnalysis } from "./useAnalysis.ts";
import { JobSearchLinks } from "./jobSearchLinks.tsx";
import { useStored } from "../shared/useStored.ts";
import type { JobPosting, TrackedJob } from "../../types.ts";

function EmptyState({ isDetecting }: { isDetecting: boolean }) {
  const searches = useStored("jobSearches");
  if (isDetecting) {
    return (
      <Card>
        <p class="muted">
          <Spinner /> Looking for a job posting on this page…
        </p>
      </Card>
    );
  }
  return (
    <div class="stack">
      <Card title="No job detected">
        <p class="muted">Open a job posting on LinkedIn, Indeed, Workday, Greenhouse, Lever, iCIMS or Ashby and it shows up here.</p>
      </Card>
      {!!searches?.length && (
        <Card title="Your job searches">
          <JobSearchLinks searches={searches} />
        </Card>
      )}
    </div>
  );
}

interface JobCardProps {
  job: JobPosting;
  tracked: TrackedJob | undefined;
  state: ReturnType<typeof useAnalysis>;
  onApply: () => void;
  onShortlist: () => void;
}

function JobCard({ job, tracked, state, onApply, onShortlist }: JobCardProps) {
  return (
    <Card>
      <h2 class="job-title">{job.title || "Untitled role"}</h2>
      <div class="job-company">{job.company}</div>
      <div class="muted">{[job.location, job.employmentType].filter(Boolean).join(" · ")}</div>
      <div class="row wrap">
        <span class="badge">{job.source}</span>
        {job.salaryText && <span class="badge basis-posted">{job.salaryText}</span>}
      </div>
      <div class="row wrap">
        <Button kind="primary" onClick={onApply}>
          Apply
        </Button>
        <Button onClick={onShortlist} title={tracked ? "Change status or remove in Tracker" : undefined}>
          {tracked ? "★ Shortlisted" : "★ Shortlist"}
        </Button>
        <Button isBusy={state.isAnalyzing} onClick={state.analyze}>
          {state.analysis ? "Re-analyze" : "Analyze match"}
        </Button>
      </div>
    </Card>
  );
}

function canUnshortlist(tracked: TrackedJob): boolean {
  return tracked.status === "saved" && !tracked.notes && !tracked.coverLetter;
}

interface AnalysisTabProps {
  active: ActiveJob;
  hasResume: boolean;
  onApply: () => void;
}

export function AnalysisTab({ active, hasResume, onApply }: AnalysisTabProps) {
  const { job, isDetecting } = active;
  const state = useAnalysis(job, hasResume);
  const jobs = useStored("jobs");
  if (!job) return <EmptyState isDetecting={isDetecting} />;

  const tracked = jobs?.[job.id];
  const toggleShortlist = async () => {
    if (!tracked) await trackedJobs.track(job, { analysis: state.analysis ? { ...state.analysis, salary: state.salary } : null });
    else if (canUnshortlist(tracked)) await trackedJobs.untrack(job.id);
  };
  return (
    <div class="stack">
      <JobCard job={job} tracked={tracked} state={state} onApply={onApply} onShortlist={() => void toggleShortlist()} />
      <ErrorNote message={state.error} onRetry={state.analyze} />
      {state.isAnalyzing && (
        <Card>
          <p class="muted">
            <Spinner /> Analyzing against your resume…
          </p>
        </Card>
      )}
      {state.analysis && !state.isAnalyzing && <AnalysisView analysis={state.analysis} />}
      <SalarySection salary={state.salary} isLoading={state.isEstimating} error={state.salaryError} onEstimate={state.estimate} />
    </div>
  );
}
