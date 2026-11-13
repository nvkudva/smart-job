import type { Rect } from "./layout.ts";
import * as rewrite from "./rewrite.ts";

export interface PreviewChange {
  before: string;
  after: string;
  reason: string;
  page: number;
  rects: Rect[];
}

export interface TailoredPreview {
  jobTitle: string;
  company: string;
  fileName: string;
  originalBase64: string;
  tailoredBase64: string;
  changes: PreviewChange[];
}

// not part of the typed store: it is one throwaway slot that the preview tab reads
const storageKey = "tailoredPreview";

export function changesOf(placements: rewrite.Placement[]): PreviewChange[] {
  return placements.map((placement) => ({
    before: placement.block.text,
    after: placement.lines.join(" "),
    reason: placement.reason,
    page: placement.block.page,
    rects: rewrite.highlights(placement.block),
  }));
}

export async function save(preview: TailoredPreview): Promise<void> {
  await chrome.storage.local.set({ [storageKey]: preview });
}

export async function load(): Promise<TailoredPreview | null> {
  const stored = await chrome.storage.local.get(storageKey);
  return (stored[storageKey] as TailoredPreview | undefined) ?? null;
}

export async function open(): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL("resumePreview.html") });
}

export function fromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export function downloadPdf(fileName: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSS percentages that place a PDF-space rect over a rendered page; `view` is the page's [x0, y0, x1, y1]. */
export function toPercent(rect: Rect, view: number[]): { left: string; top: string; width: string; height: string } {
  const [x0, y0, x1, y1] = view as [number, number, number, number];
  const pageWidth = x1 - x0;
  const pageHeight = y1 - y0;
  return {
    left: `${((rect.x - x0) / pageWidth) * 100}%`,
    top: `${((y1 - rect.y - rect.height) / pageHeight) * 100}%`,
    width: `${(rect.width / pageWidth) * 100}%`,
    height: `${(rect.height / pageHeight) * 100}%`,
  };
}
