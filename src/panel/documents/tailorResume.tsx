import * as pdfjs from "pdfjs-dist";
import { useMemo, useRef, useState } from "preact/hooks";
import * as tasks from "../../ai/tasks.ts";
import * as session from "../../fill/session.ts";
import { toBase64 } from "../../profile/resumeFile.ts";
import * as layout from "../../resume/layout.ts";
import * as preview from "../../resume/preview.ts";
import * as render from "../../resume/render.ts";
import * as rewrite from "../../resume/rewrite.ts";
import * as storage from "../../storage.ts";
import type { JobPosting, Resume } from "../../types.ts";
import * as aiContext from "../shared/aiContext.ts";
import { Button, Card, AiErrorNote, ErrorNote } from "../shared/controls.tsx";
import * as trackedJobs from "../job/trackedJobs.ts";
import * as markdown from "./markdown.ts";
import { SavedResumes } from "./savedResumes.tsx";
import { ChangeCard, type Draft } from "./tailorChanges.tsx";
import * as tailoredResumes from "./tailoredResumes.ts";
import { useTask } from "../shared/useTask.ts";

type Change = { before: string; after: string; reason: string };

/** What stays in memory while the user edits: the original file and its layout, since blocks are not stored. */
interface PdfWork {
  original: Uint8Array;
  resumeLayout: layout.Layout;
  measurer: rewrite.Measurer;
  resume: Resume;
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

async function openPdfWork(resume: Resume): Promise<PdfWork | null> {
  const original = preview.fromBase64(resume.fileBase64);
  const resumeLayout = await readLayout(original);
  if (layout.allBlocks(resumeLayout).length === 0) return null;
  return { original, resumeLayout, measurer: await render.createMeasurer(), resume };
}

const toDraft = (placement: rewrite.Placement): Draft => ({ block: placement.block, text: placement.lines.join(" "), reason: placement.reason, isOn: true, isEdited: false });

/** Fresh AI drafts, except lines the user edited, which stay as they are. */
function mergeDrafts(current: Draft[], fresh: Draft[], resumeLayout: layout.Layout): Draft[] {
  const kept = current.filter((draft) => draft.isEdited);
  const keptIds = new Set(kept.map((draft) => draft.block.id));
  const order = new Map(layout.allBlocks(resumeLayout).map((block, index) => [block.id, index]));
  return [...kept, ...fresh.filter((draft) => !keptIds.has(draft.block.id))].sort((a, b) => order.get(a.block.id)! - order.get(b.block.id)!);
}

/** The PDF for the drafts as they are now. `misfits` counts turned-on lines that do not fit, which are left out. */
async function buildPdf(work: PdfWork, drafts: Draft[]): Promise<{ bytes: Uint8Array; placements: rewrite.Placement[]; misfits: number }> {
  const placements: rewrite.Placement[] = [];
  let misfits = 0;
  for (const draft of drafts.filter((item) => item.isOn)) {
    const fitted = rewrite.fit(draft.text, draft.block, work.measurer, draft.reason);
    if ("placement" in fitted) placements.push(fitted.placement);
    else misfits++;
  }
  const bytes = placements.length ? await render.apply(work.original, placements) : work.original;
  return { bytes, placements, misfits };
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

export function TailorResume({ job, tabId }: { job: JobPosting; tabId: number | null }) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [text, setText] = useState("");
  const [work, setWork] = useState<PdfWork | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [instruction, setInstruction] = useState("");
  const [hasRun, setHasRun] = useState(false);
  const [note, setNote] = useState("");
  const savedId = useRef<string | undefined>(undefined);

  const fits = useMemo(() => (work ? drafts.map((draft) => rewrite.fit(draft.text, draft.block, work.measurer, draft.reason)) : []), [work, drafts]);
  const misfitCount = drafts.filter((draft, index) => draft.isOn && "overBy" in fits[index]!).length;
  const fileName = work ? tailoredFileName(work.resume, job) : "";

  /** Builds the PDF from the cards as they are, and keeps it with the job and for the side-by-side preview. */
  const finish = async (current: PdfWork, currentDrafts: Draft[]) => {
    const { bytes, placements } = await buildPdf(current, currentDrafts);
    const previewChanges = preview.changesOf(placements);
    await preview.save({ jobTitle: job.title, company: job.company, fileName, originalBase64: current.resume.fileBase64, tailoredBase64: toBase64(bytes), changes: previewChanges });
    savedId.current = await tailoredResumes.save(job, { fileName, pdfBase64: toBase64(bytes), markdown: "", changeCount: previewChanges.length }, savedId.current);
    return { bytes, hasChanges: previewChanges.length > 0 };
  };

  const generate = useTask(async () => {
    const resume = await storage.get("resume");
    const opened = isPdfResume(resume) ? await openPdfWork(resume) : null;
    setHasRun(true);
    // a tailored resume belongs to an application, so the job joins the tracker and the file is kept with it
    await trackedJobs.track(job);
    if (opened) {
      const placements = await aiContext.run(({ client, candidate }) => tasks.tailorPdf(client, job, candidate, opened.resumeLayout, opened.measurer, { instruction }));
      const merged = mergeDrafts(drafts, placements.map(toDraft), opened.resumeLayout);
      setWork(opened);
      setDrafts(merged);
      setNote(merged.length === 0 ? "No rewrite that fits your resume layout was proposed. Try different instructions." : "");
      await finish(opened, merged);
      return;
    }
    setWork(null);
    setDrafts([]);
    const tailored = await aiContext.run(({ client, candidate }) => tasks.tailorResume(client, job, candidate));
    setChanges(tailored.changes);
    setText(tailored.markdown);
    savedId.current = await tailoredResumes.save(job, { fileName: `resume-${job.company || "job"}.md`.replace(/\s+/g, "-"), pdfBase64: "", markdown: tailored.markdown, changeCount: tailored.changes.length }, savedId.current);
  });

  const patchDraft = (blockId: string, patch: Partial<Draft>) => setDrafts((current) => current.map((draft) => (draft.block.id === blockId ? { ...draft, ...patch } : draft)));

  const askAbout = async (draft: Draft, ask: string) => {
    if (!work) return;
    const placements = await aiContext.run(({ client, candidate }) =>
      tasks.tailorPdf(client, job, candidate, work.resumeLayout, work.measurer, { instruction: ask, onlyIds: [draft.block.id], drafts: { [draft.block.id]: draft.text } }),
    );
    const next = placements.find((placement) => placement.block.id === draft.block.id);
    if (!next) throw new Error("The AI had no usable change for this line. Try different wording.");
    patchDraft(draft.block.id, { text: next.lines.join(" "), reason: next.reason || draft.reason, isOn: true, isEdited: true });
  };

  const output = useTask(async (action: "preview" | "download" | "attach") => {
    if (!work) return;
    if (misfitCount > 0) throw new Error(`${misfitCount} line${misfitCount > 1 ? "s are" : " is"} too long to fit. Shorten ${misfitCount > 1 ? "them" : "it"} or turn ${misfitCount > 1 ? "them" : "it"} off first.`);
    const { bytes, hasChanges } = await finish(work, drafts);
    if (action === "preview") {
      if (!hasChanges) throw new Error("Nothing is changed yet, so there is nothing to compare.");
      await preview.open();
    } else if (action === "download") preview.downloadPdf(fileName, bytes);
    else {
      if (!tabId) throw new Error("Open the application page in this tab first.");
      await session.attachFile(tabId, { name: fileName, base64: toBase64(bytes), mimeType: "application/pdf" }, "resume");
    }
  });

  return (
    <Card title="Tailored resume">
      <p class="muted small">
        Rewrites your summary and bullets toward this job without adding facts. A PDF resume keeps its exact look: only the changed lines are redrawn. Review every change.
      </p>
      <label class="field">
        <textarea rows={2} value={instruction} onInput={(event) => setInstruction(event.currentTarget.value)} placeholder="e.g. Make it more polite. Highlight leadership in my latest role." />
        <span>Instructions for the AI (optional)</span>
      </label>
      <Button kind="primary" isBusy={generate.isBusy} onClick={() => void generate.run()}>
        {hasRun ? "Regenerate" : "Generate"}
      </Button>
      {drafts.some((draft) => draft.isEdited) && <p class="muted small">Regenerate keeps the lines you edited.</p>}
      <AiErrorNote message={generate.error} onRetry={() => void generate.run()} />
      {work && (
        <>
          {note && <p class="muted">{note}</p>}
          <div class="block">
            <h4>Changes ({drafts.filter((draft) => draft.isOn).length} of {drafts.length} on)</h4>
            <div class="stack tight">
              {drafts.map((draft, index) => (
                <ChangeCard
                  key={draft.block.id}
                  draft={draft}
                  fit={fits[index]!}
                  maxChars={rewrite.maxCharsOf(draft.block)}
                  onChange={(patch) => patchDraft(draft.block.id, patch)}
                  onAsk={(ask) => askAbout(draft, ask)}
                />
              ))}
            </div>
          </div>
          {drafts.length > 0 && (
            <div class="row wrap">
              <Button kind="primary" isBusy={output.isBusy} onClick={() => void output.run("attach")}>Attach to form</Button>
              <Button isBusy={output.isBusy} onClick={() => void output.run("download")}>Download PDF</Button>
              <Button isBusy={output.isBusy} onClick={() => void output.run("preview")}>Side-by-side preview</Button>
            </div>
          )}
          <ErrorNote message={output.error} />
        </>
      )}
      {!work && <ChangeList changes={changes} />}
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
