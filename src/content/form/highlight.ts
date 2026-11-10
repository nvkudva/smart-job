import type { FillSource } from "../../types.ts";
import * as scanner from "./scanner.ts";

export type Mark = "profile" | "ai" | "review";

const COLORS: Record<Mark, string> = { profile: "#16a34a", ai: "#2563eb", review: "#d97706" };

export function markFor(source: FillSource): Mark {
  return source === "ai" ? "ai" : "profile";
}

/** Radios, checkboxes and file inputs are often invisible; outline their visible container instead. */
function targetOf(element: HTMLElement): HTMLElement {
  const isCustomControl = element instanceof HTMLInputElement && ["radio", "checkbox", "file"].includes(element.type);
  if (!isCustomControl) return element;
  return element.closest<HTMLElement>("fieldset, [role=radiogroup], label") ?? element.parentElement ?? element;
}

export function mark(element: HTMLElement, kind: Mark): void {
  const target = targetOf(element);
  if (target.dataset.sjHighlight === undefined) target.dataset.sjPrevOutline = target.style.outline;
  target.dataset.sjHighlight = kind;
  target.style.outline = `2px solid ${COLORS[kind]}`;
  target.style.outlineOffset = "1px";
}

export function clear(): void {
  for (const target of document.querySelectorAll<HTMLElement>("[data-sj-highlight]")) {
    target.style.outline = target.dataset.sjPrevOutline ?? "";
    target.style.outlineOffset = "";
    delete target.dataset.sjHighlight;
    delete target.dataset.sjPrevOutline;
  }
}

export function focus(id: string): boolean {
  const element = scanner.findElement(id);
  if (!element) return false;
  const target = targetOf(element);
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  element.focus({ preventScroll: true });
  const previous = target.style.boxShadow;
  target.style.boxShadow = "0 0 0 5px rgba(250, 204, 21, 0.8)";
  setTimeout(() => (target.style.boxShadow = previous), 1200);
  return true;
}
