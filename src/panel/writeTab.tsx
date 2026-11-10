import { useEffect, useState } from "preact/hooks";
import type { JobPosting } from "../types.ts";
import { Card, Choice } from "./controls.tsx";
import { CoverLetter } from "./coverLetter.tsx";
import { QuestionAnswerer } from "./questionAnswerer.tsx";
import { TailorResume } from "./tailorResume.tsx";
import { useStored } from "./useStored.ts";

interface WriteTabProps {
  currentJob: JobPosting | null;
  /** job the user asked to write for from the Job tab */
  preferredJobId: string | null;
}

export function WriteTab({ currentJob, preferredJobId }: WriteTabProps) {
  const jobs = useStored("jobs");
  const [selectedId, setSelectedId] = useState(preferredJobId ?? "");
  useEffect(() => void (preferredJobId && setSelectedId(preferredJobId)), [preferredJobId]);

  const options = new Map<string, JobPosting>();
  if (currentJob) options.set(currentJob.id, currentJob);
  for (const entry of Object.values(jobs ?? {})) options.set(entry.job.id, entry.job);
  const job = options.get(selectedId) ?? currentJob ?? [...options.values()][0] ?? null;

  return (
    <div class="stack">
      {options.size > 0 ? (
        <Choice
          label="Write for"
          value={job?.id ?? ""}
          options={[...options.values()].map((option) => [option.id, `${option.title} @ ${option.company}`] as const)}
          onValue={setSelectedId}
        />
      ) : (
        <Card>
          <p class="muted">Open a job posting or shortlist a job to write a cover letter or tailor your resume. The question answerer below works without one.</p>
        </Card>
      )}
      {job && <CoverLetter key={`letter-${job.id}`} job={job} tracked={jobs?.[job.id]} />}
      {job && <TailorResume key={`tailor-${job.id}`} job={job} />}
      <QuestionAnswerer key={`question-${job?.id ?? ""}`} job={job} />
    </div>
  );
}
