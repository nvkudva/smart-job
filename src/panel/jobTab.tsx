import type { ActiveJob } from "./activeTab.ts";
import { AnalysisView } from "./analysisView.tsx";
import { Button, Card, ErrorNote, Spinner } from "./controls.tsx";
import { SalarySection } from "./salary.tsx";
import * as trackedJobs from "./trackedJobs.ts";
import { useAnalysis } from "./useAnalysis.ts";
import { useStored } from "./useStored.ts";
import type { JobPosting, TrackedJob } from "../types.ts";

function EmptyState({ isDetecting }: { isDetecting: boolean }) {
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
    <Card title="No job detected">
      <p class="muted">Open a job posting on LinkedIn, Indeed, Workday, Greenhouse, Lever, iCIMS or Ashby and it shows up here.</p>
    </Card>
  );
}

function JobCard({ job }: { job: JobPosting }) {
  return (
    <Card>
      <h2 class="job-title">{job.title || "Untitled role"}</h2>
      <div class="job-company">{job.company}</div>
      <div class="muted">{[job.location, job.employmentType].filter(Boolean).join(" · ")}</div>
      <div class="row wrap">
        <span class="badge">{job.source}</span>
        {job.salaryText && <span class="badge basis-posted">{job.salaryText}</span>}
      </div>
    </Card>
  );
}

function canUnshortlist(tracked: TrackedJob): boolean {
  return tracked.status === "saved" && !tracked.notes && !tracked.coverLetter;
}

interface JobTabProps {
  active: ActiveJob;
  hasResume: boolean;
  onWrite: (jobId: string) => void;
}

export function JobTab({ active, hasResume, onWrite }: JobTabProps) {
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
      <JobCard job={job} />
      <div class="row wrap">
        <Button kind={tracked ? "ghost" : "primary"} onClick={toggleShortlist} title={tracked ? "Change status or remove in Tracker" : undefined}>
          {tracked ? "★ Shortlisted" : "★ Shortlist"}
        </Button>
        <Button onClick={() => onWrite(job.id)}>Cover letter</Button>
        <Button onClick={() => onWrite(job.id)}>Tailor resume</Button>
      </div>
      {state.isAnalyzing && (
        <Card>
          <p class="muted">
            <Spinner /> Analyzing against your resume…
          </p>
        </Card>
      )}
      <ErrorNote message={state.error} onRetry={state.analyze} />
      {state.analysis && !state.isAnalyzing && <AnalysisView analysis={state.analysis} />}
      {!state.analysis && !state.isAnalyzing && !state.error && (
        <Button kind="primary" onClick={state.analyze}>
          Analyze match
        </Button>
      )}
      {state.analysis && !state.isAnalyzing && <Button onClick={state.analyze}>Re-analyze</Button>}
      <SalarySection salary={state.salary} isLoading={state.isEstimating} error={state.salaryError} onEstimate={state.estimate} />
    </div>
  );
}
