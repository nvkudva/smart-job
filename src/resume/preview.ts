import type { JobPosting } from "../types.ts";
import type { Rect } from "./layout.ts";

/** What the editor needs to rebuild a line: the user's wording and whether it is applied. Blocks are found again from the original PDF by id. */
export interface StoredDraft {
  blockId: string;
  text: string;
  reason: string;
  isOn: boolean;
  isEdited: boolean;
}

export interface TailoredPreview {
  job: JobPosting;
  fileName: string;
  originalBase64: string;
  tailoredBase64: string;
  drafts: StoredDraft[];
  /** the record in the saved list that this resume keeps updating */
  savedId?: string;
  /** bumped by every write, so a page can tell its own write from the other page's */
  revision: number;
  source: "panel" | "editor";
}

// not part of the typed store: it is one throwaway slot that the editor tab and the panel share
export const storageKey = "tailoredPreview";

export async function save(preview: TailoredPreview): Promise<void> {
  await chrome.storage.local.set({ [storageKey]: preview });
}

export async function load(): Promise<TailoredPreview | null> {
  const stored = (await chrome.storage.local.get(storageKey))[storageKey] as Partial<TailoredPreview> | undefined;
  // a slot written before the editor existed has no job or drafts
  return stored?.job && stored.drafts ? (stored as TailoredPreview) : null;
}

/** Brings the editor tab to the front if it is already open, so Regenerate does not pile up tabs. */
export async function open(): Promise<void> {
  const url = chrome.runtime.getURL("resumePreview.html");
  const [existing] = await chrome.tabs.query({ url });
  if (!existing?.id) {
    await chrome.tabs.create({ url });
    return;
  }
  await chrome.tabs.update(existing.id, { active: true });
  await chrome.windows.update(existing.windowId, { focused: true });
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
