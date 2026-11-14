import type { FillSource } from "../../types.ts";
import * as scanner from "./scanner.ts";

export type Mark = "profile" | "ai" | "review" | "active";

const COLORS: Record<Mark, string> = { profile: "#16a34a", ai: "#2563eb", review: "#d97706", active: "#facc15" };

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

const SETTLE_MS = 320;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Scrolls a field into the middle of the page unless it is already comfortably in view; false when it has no box to show (hidden, or no layout). */
export async function reveal(element: HTMLElement): Promise<boolean> {
  const target = targetOf(element);
  const box = target.getBoundingClientRect();
  if (!box.width && !box.height) return false;
  const isComfortable = box.top > innerHeight * 0.15 && box.bottom < innerHeight * 0.85;
  if (!isComfortable) {
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    await sleep(SETTLE_MS);
  }
  return true;
}

// ---------- "needs your answer" pills ----------
// They live in a shadow root of their own: page frameworks re-render form markup and would wipe anything injected beside a field.

const PILL_CSS = `
.pill{position:absolute;display:flex;align-items:center;gap:7px;padding:4px 12px 4px 9px;border-radius:999px;white-space:nowrap;
  font:600 12px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;color:#7c2d12;background:linear-gradient(135deg,#fffbeb,#fde68a);
  border:1px solid #f59e0b;box-shadow:0 6px 16px rgba(217,119,6,.32);animation:rise .28s ease-out}
.pill.optional{color:#334155;background:linear-gradient(135deg,#f8fafc,#e2e8f0);border-color:#94a3b8;box-shadow:0 6px 16px rgba(71,85,105,.25)}
.dot{width:8px;height:8px;border-radius:50%;background:#f59e0b;animation:pulse 1.5s infinite}
.optional .dot{background:#64748b;animation:none}
.pill span.hint{font-weight:500;opacity:.75}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(245,158,11,.7)}70%{box-shadow:0 0 0 7px rgba(245,158,11,0)}100%{box-shadow:0 0 0 0 rgba(245,158,11,0)}}
@keyframes rise{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}`;

const REPOSITION_MS = 500;
const pills = new Map<HTMLElement, HTMLElement>();
let pillLayer: ShadowRoot | undefined;
let repositionTimer: ReturnType<typeof setInterval> | undefined;

function layer(): ShadowRoot {
  if (pillLayer?.host.isConnected) return pillLayer;
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none";
  pillLayer = host.attachShadow({ mode: "closed" });
  pillLayer.innerHTML = `<style>${PILL_CSS}</style>`;
  document.documentElement.append(host);
  return pillLayer;
}

/** A badge on the field's top-right corner; beside it when the field is too narrow to carry one. Labels sit above-left, so neither covers them. */
function place(element: HTMLElement, pill: HTMLElement): void {
  const box = targetOf(element).getBoundingClientRect();
  pill.hidden = !element.isConnected || (!box.width && !box.height);
  const isWideEnough = box.width >= pill.offsetWidth + 200;
  const left = isWideEnough ? box.right - pill.offsetWidth - 8 : box.right + 10;
  const top = isWideEnough ? box.top - pill.offsetHeight * 0.6 : box.top + (box.height - pill.offsetHeight) / 2;
  pill.style.left = `${Math.min(Math.max(8, left + scrollX), scrollX + innerWidth - pill.offsetWidth - 8)}px`;
  pill.style.top = `${Math.max(4, top + scrollY)}px`;
}

function placeAll(): void {
  for (const [element, pill] of pills) place(element, pill);
}

function pillOf(isRequired: boolean): HTMLElement {
  const pill = document.createElement("div");
  pill.className = isRequired ? "pill" : "pill optional";
  const dot = document.createElement("span");
  dot.className = "dot";
  const text = document.createElement("span");
  text.textContent = isRequired ? "Needs your answer" : "Optional: add an answer";
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = "· SmartJob will remember it";
  pill.append(dot, text, hint);
  return pill;
}

/** Outlines a field SmartJob had no answer for and pins a pill above it. */
export function markUnknown(element: HTMLElement, isRequired: boolean): void {
  mark(element, "review");
  release(element);
  const pill = pillOf(isRequired);
  layer().append(pill);
  pills.set(element, pill);
  place(element, pill);
  repositionTimer ??= setInterval(placeAll, REPOSITION_MS);
}

/** Removes a field's pill, e.g. once the user answered it or it was filled. */
export function release(element: HTMLElement): void {
  pills.get(element)?.remove();
  pills.delete(element);
  if (!pills.size) {
    clearInterval(repositionTimer);
    repositionTimer = undefined;
  }
}

export function clear(): void {
  for (const element of [...pills.keys()]) release(element);
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
