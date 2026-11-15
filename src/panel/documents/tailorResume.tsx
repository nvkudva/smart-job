import * as pdfjs from "pdfjs-dist";
import { useRef, useState } from "preact/hooks";
import * as tasks from "../../ai/tasks.ts";
import { toBase64 } from "../../profile/resumeFile.ts";
import * as layout from "../../resume/layout.ts";
import * as preview from "../../resume/preview.ts";
import * as render from "../../resume/render.ts";
import * as storage from "../../storage.ts";
import type { JobPosting, Resume } from "../../types.ts";
import * as aiContext from "../shared/aiContext.ts";
import { Button, Card, AiErrorNote } from "../shared/controls.tsx";
import * as trackedJobs from "../job/trackedJobs.ts";
import * as markdown from "./markdown.ts";
import { SavedResumes } from "./savedResumes.tsx";
import * as tailoredResumes from "./tailoredResumes.ts";
import { useTask } from "../shared/useTask.ts";

type Change = { before: string; after: string; reason: string };

interface PdfResult {
  changes: Change[];
  bytes: Uint8Array;
  fileName: string;
}

function isPdfResume(resume: Resume | null): resume is Resume {
  return resume !== null && resume.mimeType === "application/pdf" && resume.fileBase64 !== "";
}

async function readLayout(bytes: Uint8Array): Promise<layout.Layout> {
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs");
  // pdf.js transfers the buffer to its worker, so give it a copy
  const loading = pdfjs.getDocument({ data: bytes.slice(), fontExtraProperties: true });
  try {
    const document = await loading.promise;
    const resumeLayout = await layout.read(document);
    await layout.sampleColors(document, resumeLayout);
    return resumeLayout;
  } finally {
    await loading.destroy();
  }
}

function tailoredFileName(resume: Resume, job: JobPosting): string {
  const base = resume.fileName.replace(/\.pdf$/i, "") || "resume";
  return `${base}-tailored-${job.company || "job"}.pdf`.replace(/\s+/g, "-");
}

/** Null when the PDF has no editable text lines (a scan), so the caller can fall back to the markdown flow. */
async function tailorPdf(job: JobPosting, resume: Resume): Promise<PdfResult | null> {
  const original = preview.fromBase64(resume.fileBase64);
  const resumeLayout = await readLayout(original);
  if (layout.allBlocks(resumeLayout).length === 0) return null;
  const measurer = await render.createMeasurer();
  const placements = await aiContext.run(({ client, candidate }) => tasks.tailorPdf(client, job, candidate, resumeLayout, measurer));
  const bytes = placements.length ? await render.apply(original, placements) : original;
  const changes = preview.changesOf(placements);
  const fileName = tailoredFileName(resume, job);
  await preview.save({ jobTitle: job.title, company: job.company, fileName, originalBase64: resume.fileBase64, tailoredBase64: toBase64(bytes), changes });
  return { changes, bytes, fileName };
}

function ChangeList({ changes }: { changes: Change[] }) {
  if (changes.length === 0) return null;
  return (
    <div class="block">
      <h4>Changes ({changes.length})</h4>
      {changes.map((change) => (
        <div class="change">
          {change.before && <div class="before">{change.before}</div>}
          <div class="after">→ {change.after}</div>
          <div class="muted small">{change.reason}</div>
        </div>
      ))}
    </div>
  );
}

export function TailorResume({ job }: { job: JobPosting }) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [text, setText] = useState("");
  const [pdf, setPdf] = useState<PdfResult | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const savedId = useRef<string | undefined>(undefined);

  const generate = useTask(async () => {
    const resume = await storage.get("resume");
    const tailoredPdf = isPdfResume(resume) ? await tailorPdf(job, resume) : null;
    setPdf(tailoredPdf);
    setHasRun(true);
    // a tailored resume belongs to an application, so the job joins the tracker and the file is kept with it
    await trackedJobs.track(job);
    if (tailoredPdf) {
      setChanges(tailoredPdf.changes);
      setText("");
      savedId.current = await tailoredResumes.save(job, { fileName: tailoredPdf.fileName, pdfBase64: toBase64(tailoredPdf.bytes), markdown: "", changeCount: tailoredPdf.changes.length }, savedId.current);
      return;
    }
    const tailored = await aiContext.run(({ client, candidate }) => tasks.tailorResume(client, job, candidate));
    setChanges(tailored.changes);
    setText(tailored.markdown);
    savedId.current = await tailoredResumes.save(job, { fileName: `resume-${job.company || "job"}.md`.replace(/\s+/g, "-"), pdfBase64: "", markdown: tailored.markdown, changeCount: tailored.changes.length }, savedId.current);
  });

  return (
    <Card title="Tailored resume">
      <p class="muted small">
        Rewrites your summary and bullets toward this job without adding facts. A PDF resume keeps its exact look: only the changed lines are redrawn. Review every change.
      </p>
      <Button kind="primary" isBusy={generate.isBusy} onClick={() => void generate.run()}>
        {hasRun ? "Regenerate" : "Generate"}
      </Button>
      <AiErrorNote message={generate.error} onRetry={() => void generate.run()} />
      {pdf && (
        <div class="row wrap">
          <Button kind="primary" onClick={() => void preview.open()} disabled={pdf.changes.length === 0}>
            Open side-by-side preview
          </Button>
          <Button onClick={() => preview.downloadPdf(pdf.fileName, pdf.bytes)}>Download tailored PDF</Button>
        </div>
      )}
      {pdf && pdf.changes.length === 0 && <p class="muted">No rewrite that fits your resume layout was proposed. Try Regenerate.</p>}
      <ChangeList changes={changes} />
      {text && (
        <>
          <textarea
            rows={14}
            aria-label="Tailored resume markdown"
            value={text}
            onInput={(event) => setText(event.currentTarget.value)}
            onBlur={() => savedId.current && void tailoredResumes.updateMarkdown(savedId.current, text)}
          />
          <Button onClick={() => markdown.openPrintable(text, `Resume - ${job.title}`)}>Open printable PDF</Button>
        </>
      )}
      <SavedResumes jobId={job.id} />
    </Card>
  );
}
