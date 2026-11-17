import * as pdfjs from "pdfjs-dist";
import * as layout from "../../resume/layout.ts";
import * as preview from "../../resume/preview.ts";
import * as render from "../../resume/render.ts";
import * as rewrite from "../../resume/rewrite.ts";
import * as normalize from "../../ai/normalize.ts";
import type { JobPosting } from "../../types.ts";

export interface Draft {
  block: layout.Block;
  /** the user's current wording for this line */
  text: string;
  reason: string;
  /** false puts the original line back in the PDF */
  isOn: boolean;
  /** typed or AI-directed by the user, so a global regenerate keeps it */
  isEdited: boolean;
}

/** What stays in memory while editing: the original file and its layout, since blocks are not stored. */
export interface PdfWork {
  original: Uint8Array;
  resumeLayout: layout.Layout;
  measurer: rewrite.Measurer;
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

/** Null when the PDF has no editable text lines (a scan), so the caller can fall back to the markdown flow. */
export async function openWork(originalBase64: string): Promise<PdfWork | null> {
  const original = preview.fromBase64(originalBase64);
  const resumeLayout = await readLayout(original);
  if (layout.allBlocks(resumeLayout).length === 0) return null;
  return { original, resumeLayout, measurer: await render.createMeasurer(original) };
}

export function fileNameFor(resumeFileName: string, job: JobPosting): string {
  const base = resumeFileName.replace(/\.pdf$/i, "") || "resume";
  return `${base}-tailored-${job.company || "job"}.pdf`.replace(/\s+/g, "-");
}

export const toDraft = (placement: rewrite.Placement): Draft => ({ block: placement.block, text: placement.lines.join(" "), reason: placement.reason, isOn: true, isEdited: false });

const orderOf = (resumeLayout: layout.Layout) => new Map(layout.allBlocks(resumeLayout).map((block, index) => [block.id, index]));

/** Fresh AI drafts, except lines the user edited, which stay as they are. */
export function mergeDrafts(current: Draft[], fresh: Draft[], resumeLayout: layout.Layout): Draft[] {
  const kept = current.filter((draft) => draft.isEdited);
  const keptIds = new Set(kept.map((draft) => draft.block.id));
  const order = orderOf(resumeLayout);
  return [...kept, ...fresh.filter((draft) => !keptIds.has(draft.block.id))].sort((a, b) => order.get(a.block.id)! - order.get(b.block.id)!);
}

export const dehydrate = (drafts: Draft[]): preview.StoredDraft[] => drafts.map((draft) => ({ blockId: draft.block.id, text: draft.text, reason: draft.reason, isOn: draft.isOn, isEdited: draft.isEdited }));

/** Drafts for the stored ids; `dropped` counts ids the layout no longer has, so the editor can say so. */
export function hydrate(stored: preview.StoredDraft[], resumeLayout: layout.Layout): { drafts: Draft[]; dropped: number } {
  const blocks = new Map(layout.allBlocks(resumeLayout).map((block) => [block.id, block]));
  const drafts = stored.flatMap(({ blockId, ...rest }) => {
    const block = blocks.get(blockId);
    return block ? [{ block, ...rest }] : [];
  });
  return { drafts, dropped: stored.length - drafts.length };
}

/** The PDF for the drafts as they are now. `misfits` counts turned-on lines that do not fit; those are left out. A draft equal to its original line changes nothing. */
export async function buildPdf(work: PdfWork, drafts: Draft[]): Promise<{ bytes: Uint8Array; placements: rewrite.Placement[]; misfits: number }> {
  const placements: rewrite.Placement[] = [];
  let misfits = 0;
  for (const draft of drafts.filter((item) => item.isOn)) {
    const fitted = rewrite.fit(draft.text, draft.block, work.measurer, draft.reason);
    if (!("placement" in fitted)) misfits++;
    else if (normalize.comparable(fitted.cleaned) !== normalize.comparable(draft.block.text)) placements.push(fitted.placement);
  }
  const bytes = placements.length ? await render.apply(work.original, placements) : work.original;
  return { bytes, placements, misfits };
}
