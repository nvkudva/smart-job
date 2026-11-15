import type { JobPosting } from "../../types.ts";
import { Card } from "../shared/controls.tsx";
import { CoverLetter } from "./coverLetter.tsx";
import { QuestionAnswerer } from "../apply/questionAnswerer.tsx";
import { TailorResume } from "./tailorResume.tsx";
import { useStored } from "../shared/useStored.ts";

/** Cover letter, tailored resume and question answerer for the job in the current tab; to work on another job, open its tab (the Track tab's Continue button does that). */
export function DocumentsSection({ currentJob: job, tabId }: { currentJob: JobPosting | null; tabId: number | null }) {
  const jobs = useStored("jobs");

  return (
    <div class="stack">
      {job ? (
        <p class="muted small">For {job.title} @ {job.company}</p>
      ) : (
        <Card>
          <p class="muted">Open a job posting to write a cover letter or tailor your resume. The question answerer below works without one.</p>
        </Card>
      )}
      {job && <CoverLetter key={`letter-${job.id}`} job={job} tabId={tabId} tracked={jobs?.[job.id]} />}
      {job && <TailorResume key={`tailor-${job.id}`} job={job} tabId={tabId} />}
      <QuestionAnswerer key={`question-${job?.id ?? ""}`} job={job} />
    </div>
  );
}
