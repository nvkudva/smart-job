import type { ActiveJob } from "./activeTab.ts";
import { AnalysisDetails, ScoreRing } from "./analysisView.tsx";
import { AiErrorNote, Button, Card, Spinner } from "../shared/controls.tsx";
import { OfficeSection } from "./office.tsx";
import { PerksSection } from "./perks.tsx";
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
  const analysis = state.isAnalyzing ? null : state.analysis;
  return (
    <Card>
      <div class="job-top">
        <div class="job-head">
          <h2 class="job-title">{job.title || "Untitled role"}</h2>
          <div class="muted">
            <strong class="job-company">{job.company}</strong>
            {[job.location, job.employmentType].filter(Boolean).map((part) => ` · ${part}`)}
          </div>
        </div>
        {analysis && <ScoreRing score={analysis.matchScore} />}
      </div>
      <div class="job-foot">
        <div class="row wrap">
          <span class="badge">{job.source}</span>
          {job.salaryText && <span class="badge basis-posted">{job.salaryText}</span>}
        </div>
        <div class="actions">
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
      </div>
      {state.isAnalyzing && (
        <p class="muted">
          <Spinner /> Analyzing against your resume…
        </p>
      )}
      {analysis && <AnalysisDetails analysis={analysis} />}
    </Card>
  );
}

export function canUnshortlist(tracked: TrackedJob): boolean {
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
    if (!tracked) await trackedJobs.track(job, { analysis: state.analysis ? { ...state.analysis, salary: state.salary, perks: state.perks, office: state.office } : null });
    else if (canUnshortlist(tracked)) await trackedJobs.untrack(job.id);
  };
  return (
    <div class="stack">
      <JobCard job={job} tracked={tracked} state={state} onApply={onApply} onShortlist={() => void toggleShortlist()} />
      <AiErrorNote message={state.error} onRetry={state.analyze} />
      <SalarySection salary={state.salary} isLoading={state.isEstimating} error={state.salaryError} onEstimate={state.estimate} />
      <OfficeSection office={state.office} company={job.company} isLoading={state.isFindingOffice} error={state.officeError} onFind={state.findOffice} />
      <PerksSection perks={state.perks} isLoading={state.isFindingPerks} error={state.perksError} onFind={state.findPerks} />
    </div>
  );
}
