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

// ---------- unanswered dots, the one-time "saved" note and the filling cursor ----------
// They live in a shadow root of their own: page frameworks re-render form markup and would wipe anything injected beside a field.

const LOGO = `<svg viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2563eb"/><text x="32" y="32" dy="0.35em" text-anchor="middle" font-family="system-ui,sans-serif" font-size="34" font-weight="600" fill="#fff">S</text></svg>`;
const ARROW = `<svg viewBox="0 0 24 24"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><path d="M4 3l16 7.5-7 2.5-2.5 7z" fill="url(#g)" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

const LAYER_CSS = `
.dot{position:absolute;width:8px;height:8px;border-radius:50%;background:#f59e0b;opacity:.85;animation:rise .28s ease-out}
.dot.optional{background:#94a3b8}
.note{position:absolute;display:flex;align-items:center;gap:8px;width:150px;padding:8px 10px;border-radius:10px;background:#fff;color:#475569;
  border:1px solid #e2e8f0;box-shadow:0 4px 14px rgba(15,23,42,.12);font:500 12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;animation:rise .28s ease-out}
.note svg{flex:none;width:22px;height:22px}
.cursor{position:absolute;width:26px;height:26px;margin:-4px 0 0 -4px;transition:left .32s cubic-bezier(.4,0,.2,1),top .32s cubic-bezier(.4,0,.2,1),opacity .3s}
.cursor svg{width:100%;height:100%;display:block;filter:drop-shadow(0 3px 5px rgba(59,130,246,.45));animation:float 1.6s ease-in-out infinite}
.cursor i{position:absolute;left:4px;top:4px;width:10px;height:10px;border-radius:50%;border:2px solid #3b82f6;opacity:0}
.cursor.tap i{animation:tap .45s ease-out}
@keyframes float{50%{transform:translate(2px,3px)}}
@keyframes tap{from{opacity:.8;transform:scale(.4)}to{opacity:0;transform:scale(2.6)}}
@keyframes rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;

const REPOSITION_MS = 500;
const NOTE_MS = 4500;
const CURSOR_MS = 320;
const GAP = 12;
const markers = new Map<HTMLElement, HTMLElement>();
let layerRoot: ShadowRoot | undefined;
let repositionTimer: ReturnType<typeof setInterval> | undefined;
let hasShownNote = false;
let cursor: HTMLElement | undefined;

function layer(): ShadowRoot {
  if (layerRoot?.host.isConnected) return layerRoot;
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none";
  layerRoot = host.attachShadow({ mode: "closed" });
  layerRoot.innerHTML = `<style>${LAYER_CSS}</style>`;
  document.documentElement.append(host);
  return layerRoot;
}

/** Right of the field with a gap; under it when the right side has no room. */
function place(element: HTMLElement, marker: HTMLElement): void {
  const box = targetOf(element).getBoundingClientRect();
  marker.hidden = !element.isConnected || (!box.width && !box.height);
  const fitsRight = box.right + GAP + marker.offsetWidth <= innerWidth - 8;
  const left = fitsRight ? box.right + GAP : box.right - marker.offsetWidth;
  const top = fitsRight ? box.top + (box.height - marker.offsetHeight) / 2 : box.bottom + 6;
  marker.style.left = `${Math.max(8, left + scrollX)}px`;
  marker.style.top = `${Math.max(4, top + scrollY)}px`;
}

function placeAll(): void {
  for (const [element, marker] of markers) place(element, marker);
}

function show(element: HTMLElement, marker: HTMLElement): void {
  release(element);
  layer().append(marker);
  markers.set(element, marker);
  place(element, marker);
  repositionTimer ??= setInterval(placeAll, REPOSITION_MS);
}

/** Pins a small dot beside a field SmartJob had no answer for. */
export function markUnknown(element: HTMLElement, isRequired: boolean): void {
  const dot = document.createElement("div");
  dot.className = isRequired ? "dot" : "dot optional";
  show(element, dot);
}

/** The user answered a dot field: the dot goes, and the first time only, a note says SmartJob saves answers. */
export function answered(element: HTMLElement): void {
  release(element);
  if (hasShownNote) return;
  hasShownNote = true;
  const note = document.createElement("div");
  note.className = "note";
  note.innerHTML = `${LOGO}<span>SmartJob saves your answer for next time</span>`;
  show(element, note);
  setTimeout(() => markers.get(element) === note && release(element), NOTE_MS);
}

/** Removes a field's dot or note, e.g. once the user answered it or it was filled. */
export function release(element: HTMLElement): void {
  markers.get(element)?.remove();
  markers.delete(element);
  if (!markers.size) {
    clearInterval(repositionTimer);
    repositionTimer = undefined;
  }
}

/** Glides the arrow cursor to a field being filled and waits for it to arrive. */
export async function moveCursor(element: HTMLElement): Promise<void> {
  const box = targetOf(element).getBoundingClientRect();
  const x = box.left + Math.min(60, box.width / 2) + scrollX;
  const y = box.top + box.height / 2 + scrollY;
  if (!cursor?.isConnected) {
    cursor = document.createElement("div");
    cursor.className = "cursor";
    cursor.innerHTML = `${ARROW}<i></i>`;
    cursor.style.cssText = `left:${x + 120}px;top:${y + 80}px;opacity:0`;
    layer().append(cursor);
    cursor.getBoundingClientRect();
  }
  cursor.style.cssText = `left:${x}px;top:${y}px;opacity:1`;
  await sleep(CURSOR_MS);
  cursor.classList.remove("tap");
  cursor.getBoundingClientRect();
  cursor.classList.add("tap");
}

export function hideCursor(): void {
  const leaving = cursor;
  if (!leaving) return;
  cursor = undefined;
  leaving.style.opacity = "0";
  setTimeout(() => leaving.remove(), 350);
}

export function clear(): void {
  for (const element of [...markers.keys()]) release(element);
  for (const target of document.querySelectorAll<HTMLElement>("[data-sj-highlight]")) {
    target.style.outline = target.dataset.sjPrevOutline ?? "";
    target.style.outlineOffset = "";
    delete target.dataset.sjHighlight;
    delete target.dataset.sjPrevOutline;
  }
}

export function focus(id: string, shouldFocus = true): boolean {
  const element = scanner.findElement(id);
  if (!element) return false;
  const target = targetOf(element);
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  if (!shouldFocus) return true;
  element.focus({ preventScroll: true });
  const previous = target.style.boxShadow;
  target.style.boxShadow = "0 0 0 5px rgba(250, 204, 21, 0.8)";
  setTimeout(() => (target.style.boxShadow = previous), 1200);
  return true;
}
