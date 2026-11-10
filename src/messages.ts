import type { FieldDescriptor, FieldFill, FillResult, JobPosting } from "./types.ts";

/** Messages the side panel sends to the content script (per frame). */
export type ContentRequest =
  | { type: "ping" }
  | { type: "extractJob" }
  | { type: "scanFields" }
  | { type: "fillFields"; fills: FieldFill[]; resumeFile?: { name: string; base64: string; mimeType: string } }
  | { type: "clearHighlights" }
  | { type: "focusField"; id: string };

export interface ContentResponses {
  ping: { ok: true; url: string; isTop: boolean };
  extractJob: JobPosting | null;
  scanFields: FieldDescriptor[];
  fillFields: FillResult[];
  clearHighlights: { ok: true };
  focusField: { ok: boolean };
}

/** Messages the content script broadcasts (chrome.runtime.sendMessage) for the panel. */
export type ContentEvent =
  /** DOM of a form page changed substantially (new wizard step). */
  { type: "formChanged"; url: string }
  /** in-page navigation without URL change that may show a new job */
  | { type: "jobChanged"; url: string };

export async function sendToFrame<T extends ContentRequest>(
  tabId: number,
  frameId: number,
  request: T,
): Promise<ContentResponses[T["type"]] | undefined> {
  try {
    return await chrome.tabs.sendMessage(tabId, request, { frameId });
  } catch {
    // frame without content script (chrome://, pdf viewer, not yet loaded)
    return undefined;
  }
}

export async function listFrameIds(tabId: number): Promise<number[]> {
  const frames = (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
  return frames.map((frame) => frame.frameId);
}
