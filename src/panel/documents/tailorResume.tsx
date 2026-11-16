import { useEffect, useRef, useState } from "preact/hooks";
import * as tasks from "../../ai/tasks.ts";
import { toBase64 } from "../../profile/resumeFile.ts";
import * as preview from "../../resume/preview.ts";
import * as storage from "../../storage.ts";
import type { JobPosting, Resume } from "../../types.ts";
import * as aiContext from "../shared/aiContext.ts";
import { Button, Card, AiErrorNote } from "../shared/controls.tsx";
import * as trackedJobs from "../job/trackedJobs.ts";
import * as markdown from "./markdown.ts";
import { SavedResumes } from "./savedResumes.tsx";
import * as tailoredPdf from "./tailoredPdf.ts";
import * as tailoredResumes from "./tailoredResumes.ts";
import { useTask } from "../shared/useTask.ts";

type Change = { before: string; after: string; reason: string };

function isPdfResume(resume: Resume | null): resume is Resume {
  return resume !== null && resume.mimeType === "application/pdf" && resume.fileBase64 !== "";
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

/** The resume editor tab and this panel share one slot; the panel only reads it to say what is there. */
function useEditorSlot(): preview.TailoredPreview | null {
  const [slot, setSlot] = useState<preview.TailoredPreview | null>(null);
  useEffect(() => {
    void preview.load().then(setSlot);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[preview.storageKey]) setSlot((changes[preview.storageKey]!.newValue as preview.TailoredPreview | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  return slot;
}

export function TailorResume({ job }: { job: JobPosting }) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const savedId = useRef<string | undefined>(undefined);
  const slot = useEditorSlot();
  const editorSlot = slot?.job.id === job.id ? slot : null;

  /** PDF flow: AI line rewrites become drafts, which are written to the shared slot and opened in the editor tab. */
  const tailorInEditor = async (resume: Resume, work: tailoredPdf.PdfWork) => {
    const analysis = (await storage.get("analyses"))[job.id] ?? null;
    const placements = await aiContext.run(({ client, candidate }) => tasks.tailorPdf(client, job, candidate, work.resumeLayout, work.measurer, { analysis }));
    const sameResume = editorSlot?.originalBase64 === resume.fileBase64;
    const kept = sameResume ? tailoredPdf.hydrate(editorSlot.drafts, work.resumeLayout).drafts : [];
    const drafts = tailoredPdf.mergeDrafts(kept, placements.map(tailoredPdf.toDraft), work.resumeLayout);
    setNote(drafts.length === 0 ? "No rewrite that fits your resume layout was proposed. Try different instructions." : "");
    if (drafts.length === 0) return;
    const { bytes } = await tailoredPdf.buildPdf(work, drafts);
    const fileName = tailoredPdf.fileNameFor(resume.fileName, job);
    savedId.current = await tailoredResumes.save(job, { fileName, pdfBase64: toBase64(bytes), markdown: "", changeCount: drafts.length }, sameResume ? editorSlot.savedId : savedId.current);
    await preview.save({ job, fileName, originalBase64: resume.fileBase64, tailoredBase64: toBase64(bytes), drafts: tailoredPdf.dehydrate(drafts), savedId: savedId.current, revision: (slot?.revision ?? 0) + 1, source: "panel" });
    await preview.open();
  };

  const generate = useTask(async () => {
    const resume = await storage.get("resume");
    const work = isPdfResume(resume) ? await tailoredPdf.openWork(resume.fileBase64) : null;
    // a tailored resume belongs to an application, so the job joins the tracker and the file is kept with it
    await trackedJobs.track(job);
    if (resume && work) return tailorInEditor(resume, work);
    const analysis = (await storage.get("analyses"))[job.id] ?? null;
    const tailored = await aiContext.run(({ client, candidate }) => tasks.tailorResume(client, job, candidate, analysis));
    setChanges(tailored.changes);
    setText(tailored.markdown);
    savedId.current = await tailoredResumes.save(job, { fileName: `resume-${job.company || "job"}.md`.replace(/\s+/g, "-"), pdfBase64: "", markdown: tailored.markdown, changeCount: tailored.changes.length }, savedId.current);
  });

  const changedCount = editorSlot?.drafts.filter((draft) => draft.isOn).length ?? 0;
  return (
    <Card title="Tailored resume">
      <p class="muted small">Rewrites your summary and bullets toward this job without adding facts. A PDF resume keeps its exact look; you review and edit the changes in the editor.</p>
      {editorSlot ? (
        <div class="row between wrap">
          <span class="small">
            <strong>{changedCount}</strong> line{changedCount === 1 ? "" : "s"} rewritten
          </span>
          <div class="row">
            <Button isBusy={generate.isBusy} title="Rewrite again. Lines you edited are kept." onClick={() => void generate.run()}>
              Regenerate
            </Button>
            <Button kind="primary" onClick={() => void preview.open()}>
              Open editor
            </Button>
          </div>
        </div>
      ) : (
        <Button kind="primary" isBusy={generate.isBusy} onClick={() => void generate.run()}>
          {text ? "Regenerate" : "Generate"}
        </Button>
      )}
      <AiErrorNote message={generate.error} onRetry={() => void generate.run()} />
      {note && <p class="muted">{note}</p>}
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
