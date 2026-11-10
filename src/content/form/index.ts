import type { FieldDescriptor, FieldFill, FillResult } from "../../types.ts";
import * as filler from "./filler.ts";
import * as highlight from "./highlight.ts";
import * as scanner from "./scanner.ts";

/** Scan visible fillable fields in this frame; stamps data-sj-id on each element. */
export function scan(): FieldDescriptor[] {
  return scanner.scan();
}

export async function fill(
  fills: FieldFill[],
  resumeFile?: { name: string; base64: string; mimeType: string },
): Promise<FillResult[]> {
  highlight.clear();
  const results = await filler.fillAll(fills, resumeFile);
  highlightOutcome(fills, results);
  return results;
}

const isBlank = (value: string) => value.trim() === "" || value === "false";

function highlightOutcome(fills: FieldFill[], results: FillResult[]): void {
  const touched = new Set<string>();
  fills.forEach((fill, index) => {
    const element = scanner.findElement(fill.id);
    if (!element) return;
    touched.add(fill.id);
    highlight.mark(element, results[index]?.ok ? highlight.markFor(fill.source) : "review");
  });
  for (const field of scanner.scan()) {
    const element = scanner.findElement(field.id);
    if (element && field.required && isBlank(field.currentValue) && !touched.has(field.id)) highlight.mark(element, "review");
  }
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
