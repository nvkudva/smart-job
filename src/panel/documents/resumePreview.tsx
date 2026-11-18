import * as pdfjs from "pdfjs-dist";
import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import * as tasks from "../../ai/tasks.ts";
import * as session from "../../fill/session.ts";
import { toBase64 } from "../../profile/resumeFile.ts";
import type { Rect } from "../../resume/layout.ts";
import * as layout from "../../resume/layout.ts";
import * as preview from "../../resume/preview.ts";
import * as rewrite from "../../resume/rewrite.ts";
import * as aiContext from "../shared/aiContext.ts";
import { Button, Card, ErrorNote } from "../shared/controls.tsx";
import { useTask } from "../shared/useTask.ts";
import { ChangeCard } from "./tailorChanges.tsx";
import * as tailoredPdf from "./tailoredPdf.ts";
import * as tailoredResumes from "./tailoredResumes.ts";

const renderScale = 2;
const buildDelayMs = 350;

interface Mark {
  page: number;
  rect: Rect;
  kind: "removed" | "added" | "block";
  blockId: string;
}

interface RenderedPage {
  canvas: HTMLCanvasElement;
  view: number[];
}

/** Renders every page off-screen and swaps the set in when done, so an edit neither flickers nor loses the scroll position. */
function usePages(base64: string): { pages: RenderedPage[]; error: string } {
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const draw = async () => {
      pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs");
      const loading = pdfjs.getDocument({ data: preview.fromBase64(base64) });
      const pdf = await loading.promise;
      const next: RenderedPage[] = [];
      for (let number = 1; number <= pdf.numPages && !controller.signal.aborted; number++) {
        const page = await pdf.getPage(number);
        const viewport = page.getViewport({ scale: renderScale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d")!, canvas, viewport }).promise;
        next.push({ canvas, view: page.view });
      }
      if (!controller.signal.aborted) setPages(next);
    };
    draw().catch((failure) => setError(String(failure)));
    return () => controller.abort();
  }, [base64]);
  return { pages, error };
}

interface PdfPaneProps {
  title: string;
  base64: string;
  marks: Mark[];
  selectedId: string | null;
  onPick: (blockId: string) => void;
}

function PdfPane({ title, base64, marks, selectedId, onPick }: PdfPaneProps) {
  const { pages, error } = usePages(base64);
  return (
    <section class="preview-pane">
      <h2>{title}</h2>
      {error && <div class="error">{error}</div>}
      {pages.map((page, index) => (
        <div class="preview-page">
          <div
            ref={(element) => {
              if (element && element.firstChild !== page.canvas) element.replaceChildren(page.canvas);
            }}
          />
          {marks
            .filter((mark) => mark.page === index + 1)
            .map((mark) => (
              <div
                class={`preview-mark ${mark.kind}${mark.blockId === selectedId ? " selected" : ""}`}
                style={preview.toPercent(mark.rect, page.view)}
                onClick={() => onPick(mark.blockId)}
              />
            ))}
        </div>
      ))}
    </section>
  );
}

/** Only the panel's writes reload the editor; its own saves and unrelated storage changes must not reset what is being typed. */
function usePanelSlot(): preview.TailoredPreview | null | undefined {
  const [slot, setSlot] = useState<preview.TailoredPreview | null | undefined>(undefined);
  useEffect(() => {
    void preview.load().then(setSlot);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const next = changes[preview.storageKey]?.newValue as preview.TailoredPreview | undefined;
      if (area === "local" && next?.source === "panel") setSlot(next);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  return slot;
}

/** The page the user was last on, other than this tab: where the application form is. */
async function applicationTab(): Promise<chrome.tabs.Tab> {
  const tabs = (await chrome.tabs.query({})).filter((tab) => tab.id && /^https?:/.test(tab.url ?? ""));
  tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  if (!tabs[0]) throw new Error("Open the application page in a tab first.");
  return tabs[0];
}

type SaveState = "saved" | "saving" | "failed";

function Editor({ initial }: { initial: preview.TailoredPreview }) {
  const [work, setWork] = useState<tailoredPdf.PdfWork | null>(null);
  const [drafts, setDrafts] = useState<tailoredPdf.Draft[]>([]);
  const [tailoredBase64, setTailoredBase64] = useState(initial.tailoredBase64);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [editVersion, setEditVersion] = useState(0);
  const slot = useRef(initial);
  const latest = useRef({ drafts, work, editVersion });
  latest.current = { drafts, work, editVersion };

  useEffect(() => {
    slot.current = initial;
    setTailoredBase64(initial.tailoredBase64);
    setSelectedId(null);
    void tailoredPdf.openWork(initial.originalBase64).then((opened) => {
      if (!opened) return setNote("This PDF has no editable text.");
      const restored = tailoredPdf.hydrate(initial.drafts, opened.resumeLayout);
      setWork(opened);
      setDrafts(restored.drafts);
      setNote(restored.dropped ? `${restored.dropped} saved change${restored.dropped > 1 ? "s" : ""} no longer match this resume and were dropped.` : "");
    });
  }, [initial.revision]);

  const fits = useMemo(() => (work ? drafts.map((draft) => rewrite.fit(draft.text, draft.block, work.measurer, draft.reason)) : []), [work, drafts]);
  const misfitCount = drafts.filter((draft, index) => draft.isOn && "overBy" in fits[index]!).length;

  /** Builds the PDF from the drafts and writes drafts and PDF to the shared slot in one set. Returns the bytes for Download and Attach. */
  const commit = async (): Promise<Uint8Array | null> => {
    const { drafts: currentDrafts, work: currentWork } = latest.current;
    if (!currentWork) return null;
    setSaveState("saving");
    try {
      const { bytes } = await tailoredPdf.buildPdf(currentWork, currentDrafts);
      const next = { ...slot.current, drafts: tailoredPdf.dehydrate(currentDrafts), tailoredBase64: toBase64(bytes), revision: slot.current.revision + 1, source: "editor" as const };
      await preview.save(next);
      slot.current = next;
      setTailoredBase64(next.tailoredBase64);
      setSaveState("saved");
      setSaveError("");
      return bytes;
    } catch (failure) {
      setSaveState("failed");
      setSaveError(failure instanceof Error ? failure.message : String(failure));
      return null;
    }
  };

  useEffect(() => {
    if (editVersion === 0) return;
    setSaveState("saving");
    const timer = setTimeout(() => void commit(), buildDelayMs);
    return () => clearTimeout(timer);
  }, [editVersion]);

  /** Keeps the saved-resumes list pointing at the latest PDF; done on Download, Attach and when the tab is hidden, not on every keystroke. */
  const keepInSavedList = async (bytes: Uint8Array) => {
    const { job, fileName } = slot.current;
    const savedId = await tailoredResumes.save(job, { fileName, pdfBase64: toBase64(bytes), markdown: "", changeCount: latest.current.drafts.filter((draft) => draft.isOn).length }, slot.current.savedId);
    slot.current = { ...slot.current, savedId };
    await preview.save({ ...slot.current, revision: slot.current.revision + 1, source: "editor" });
  };

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && latest.current.editVersion > 0) void commit().then((bytes) => bytes && keepInSavedList(bytes));
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  const changeDraft = (blockId: string, patch: Partial<tailoredPdf.Draft>) => {
    setDrafts((current) => current.map((draft) => (draft.block.id === blockId ? { ...draft, ...patch } : draft)));
    setEditVersion((value) => value + 1);
  };

  const pick = (blockId: string) => {
    setSelectedId(blockId);
    const block = work && layout.allBlocks(work.resumeLayout).find((candidate) => candidate.id === blockId);
    if (!block || drafts.some((draft) => draft.block.id === blockId)) return;
    const order = new Map(layout.allBlocks(work.resumeLayout).map((candidate, index) => [candidate.id, index]));
    const added: tailoredPdf.Draft = { block, text: block.text, reason: "Edited by you", isOn: true, isEdited: true };
    setDrafts((current) => [...current, added].sort((a, b) => order.get(a.block.id)! - order.get(b.block.id)!));
  };

  const askAbout = async (draft: tailoredPdf.Draft, instruction: string) => {
    if (!work) return;
    const placements = await aiContext.run(({ client, candidate }) =>
      tasks.tailorPdf(client, slot.current.job, candidate, work.resumeLayout, work.measurer, { instruction, onlyIds: [draft.block.id], drafts: { [draft.block.id]: draft.text } }),
    );
    const next = placements.find((placement) => placement.block.id === draft.block.id);
    if (!next) throw new Error("The AI had no usable change for this line. Try different wording.");
    changeDraft(draft.block.id, { text: next.lines.join(" "), reason: next.reason || draft.reason, isOn: true, isEdited: true });
  };

  const output = useTask(async (action: "download" | "attach") => {
    if (misfitCount > 0) throw new Error(`${misfitCount} line${misfitCount > 1 ? "s are" : " is"} too long to fit. Shorten ${misfitCount > 1 ? "them" : "it"} or revert ${misfitCount > 1 ? "them" : "it"} first.`);
    const bytes = await commit();
    if (!bytes) throw new Error(saveError || "Could not build the PDF.");
    await keepInSavedList(bytes);
    if (action === "download") return preview.downloadPdf(slot.current.fileName, bytes);
    const tab = await applicationTab();
    try {
      await session.attachFile(tab.id!, { name: slot.current.fileName, base64: toBase64(bytes), mimeType: "application/pdf" }, "resume");
    } catch (failure) {
      throw new Error(`${failure instanceof Error ? failure.message : failure} Tried the tab "${tab.title || tab.url}".`);
    }
  });

  const marks = useMemo(() => {
    const original: Mark[] = [];
    const tailored: Mark[] = work ? layout.allBlocks(work.resumeLayout).map((block) => ({ page: block.page, rect: rewrite.blockRect(block), kind: "block", blockId: block.id })) : [];
    drafts.forEach((draft, index) => {
      const fitted = fits[index];
      if (!work || !draft.isOn || !fitted || !("placement" in fitted)) return;
      const { removed, added } = rewrite.wordMarks(fitted.placement, work.measurer);
      original.push(...removed.map((rect): Mark => ({ page: draft.block.page, rect, kind: "removed", blockId: draft.block.id })));
      tailored.push(...added.map((rect): Mark => ({ page: draft.block.page, rect, kind: "added", blockId: draft.block.id })));
    });
    return { original, tailored };
  }, [work, drafts, fits]);

  const selectedIndex = drafts.findIndex((draft) => draft.block.id === selectedId);
  const selected = selectedIndex >= 0 ? drafts[selectedIndex]! : null;
  const changedDrafts = drafts.filter((draft) => draft.text.trim() !== draft.block.text || !draft.isOn);

  return (
    <div class="preview-root">
      <header class="preview-head">
        <div>
          <h1>Tailored resume</h1>
          <div class="muted">
            {slot.current.job.title}
            {slot.current.job.company && ` @ ${slot.current.job.company}`} · red words were removed, green words are new. Click a line on the right to edit it.
          </div>
        </div>
        <div class="row wrap">
          <span class={`small ${saveState === "failed" ? "required" : "muted"}`}>{saveState === "saving" ? "Saving…" : saveState === "failed" ? "Not saved" : "Saved"}</span>
          <Button kind="primary" isBusy={output.isBusy} onClick={() => void output.run("attach")}>
            Attach to form
          </Button>
          <Button isBusy={output.isBusy} onClick={() => void output.run("download")}>
            Download PDF
          </Button>
        </div>
      </header>
      <ErrorNote message={output.error || saveError} />
      {note && <p class="muted">{note}</p>}
      <div class="preview-grid">
        <PdfPane title="Original" base64={initial.originalBase64} marks={marks.original} selectedId={selectedId} onPick={pick} />
        <PdfPane title="Tailored (editable)" base64={tailoredBase64} marks={marks.tailored} selectedId={selectedId} onPick={pick} />
        <aside class="preview-changes">
          {selected ? (
            <ChangeCard
              key={selected.block.id}
              draft={selected}
              fit={fits[selectedIndex]!}
              maxChars={rewrite.maxCharsOf(selected.block)}
              onChange={(patch) => changeDraft(selected.block.id, patch)}
              onAsk={(instruction) => askAbout(selected, instruction)}
            />
          ) : (
            <Card>
              <p class="muted">Click any line on the tailored page to edit it, ask the AI about it, or revert it.</p>
            </Card>
          )}
          {changedDrafts.length > 0 && (
            <Card title={`Changes (${changedDrafts.length})`}>
              {changedDrafts.map((draft) => (
                <button type="button" class={`change-row${draft.block.id === selectedId ? " active" : ""}${draft.isOn ? "" : " off"}`} onClick={() => pick(draft.block.id)}>
                  {draft.isOn ? draft.text : `Reverted: ${draft.block.text}`}
                </button>
              ))}
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function App() {
  const slot = usePanelSlot();
  if (slot === undefined) return <p class="muted preview-empty">Loading…</p>;
  if (slot === null) return <p class="muted preview-empty">Nothing to edit yet. Generate a tailored resume from the SmartJob Assistant side panel (Write tab).</p>;
  return <Editor initial={slot} />;
}

render(<App />, document.getElementById("root")!);
