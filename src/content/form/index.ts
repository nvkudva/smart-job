import type { FieldDescriptor, FieldFill, FillResult } from "../../types.ts";
import * as filler from "./filler.ts";
import * as highlight from "./highlight.ts";
import * as learn from "./learn.ts";
import * as scanner from "./scanner.ts";

/** Scan visible fillable fields in this frame; stamps data-sj-id on each element. */
export function scan(): FieldDescriptor[] {
  return scanner.scan();
}

/** Fills one field at a time, scrolling to each so the user can follow along. Marks from earlier runs stay until the panel clears them. */
export async function fill(
  fills: FieldFill[],
  resumeFile?: { name: string; base64: string; mimeType: string },
): Promise<FillResult[]> {
  const fields = new Map(scanner.scan().map((field) => [field.id, field]));
  const results = await filler.fillAll(fills, resumeFile, {
    before: async (fill) => {
      const element = scanner.findElement(fill.id);
      if (!element) return;
      highlight.release(element);
      highlight.mark(element, "active");
      if (await highlight.reveal(element)) await highlight.moveCursor(element);
    },
    after: (fill, result) => {
      const element = scanner.findElement(fill.id);
      if (!element) return;
      highlight.mark(element, result.ok ? highlight.markFor(fill.source) : "review");
      const field = fields.get(fill.id);
      if (field) learn.watch(field, result.ok ? fill.source : "none", result.finalValue);
    },
  });
  highlight.hideCursor();
  return results;
}

/** Fields SmartJob had no answer for: pins a dot on each and, once the known fields are done, jumps to the first. */
export function markUnknown(unknown: { id: string; isRequired: boolean }[], shouldScroll: boolean): void {
  const fields = new Map(scanner.scan().map((field) => [field.id, field]));
  let firstId: string | undefined;
  for (const { id, isRequired } of unknown) {
    const element = scanner.findElement(id);
    const field = fields.get(id);
    if (!element || !field) continue;
    highlight.markUnknown(element, isRequired);
    learn.watch(field, "none", field.currentValue);
    firstId ??= id;
  }
  if (shouldScroll && firstId) highlight.focus(firstId, false);
}

export function clearHighlights(): void {
  highlight.clear();
}

export function focus(id: string): boolean {
  return highlight.focus(id);
}

const CHANGE_DEBOUNCE_MS = 800;

function signature(): string {
  return scanner
    .scan()
    .map((field) => `${field.kind}|${field.name}|${field.automationId}|${field.label}`)
    .join("\n");
}

/** Broadcast { type: "formChanged" } (debounced) when the form DOM changes substantially (wizard step). */
export function watchForChanges(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSignature: string | undefined;
  const check = () => {
    const current = signature();
    const previous = lastSignature;
    lastSignature = current;
    if (previous === undefined || current === previous || !current) return;
    try {
      chrome.runtime.sendMessage({ type: "formChanged", url: location.href }).catch(() => {});
    } catch {
      // extension context invalidated after reload
    }
  };
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(check, CHANGE_DEBOUNCE_MS);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  timer = setTimeout(check, CHANGE_DEBOUNCE_MS); // baseline signature
}
