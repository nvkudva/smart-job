import * as preview from "../../resume/preview.ts";
import type { TailoredResume } from "../../types.ts";
import { Button } from "../shared/controls.tsx";
import { useStored } from "../shared/useStored.ts";
import * as markdown from "./markdown.ts";
import * as tailoredResumes from "./tailoredResumes.ts";

function openPdf(entry: TailoredResume): void {
  const url = URL.createObjectURL(new Blob([preview.fromBase64(entry.pdfBase64) as BlobPart], { type: "application/pdf" }));
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function ResumeRow({ entry, canDelete }: { entry: TailoredResume; canDelete: boolean }) {
  return (
    <div class="bank-row resume-row">
      <div>
        <strong class="small">{entry.name}</strong>
        <div class="muted small">{entry.changeCount > 0 ? `${entry.changeCount} changes` : "Rewritten"}</div>
      </div>
      <div class="row wrap">
        {entry.pdfBase64 ? (
          <>
            <Button onClick={() => openPdf(entry)}>Open</Button>
            <Button onClick={() => preview.downloadPdf(entry.fileName, preview.fromBase64(entry.pdfBase64))}>Download</Button>
          </>
        ) : (
          <Button onClick={() => markdown.openPrintable(entry.markdown, entry.name)}>Print</Button>
        )}
        {canDelete && (
          <Button kind="danger" aria-label={`Delete ${entry.name}`} onClick={() => void tailoredResumes.remove(entry.id)}>
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

/** Tailored resumes saved for one job, newest first. */
export function SavedResumes({ jobId, canDelete = true }: { jobId: string; canDelete?: boolean }) {
  const saved = useStored("tailoredResumes");
  const mine = (saved ?? []).filter((entry) => entry.jobId === jobId);
  if (mine.length === 0) return null;
  return (
    <div class="block">
      <h4>Saved resumes ({mine.length})</h4>
      {mine.map((entry) => (
        <ResumeRow key={entry.id} entry={entry} canDelete={canDelete} />
      ))}
    </div>
  );
}
