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

const MIN_FIELD_WIDTH = 120;

/** Custom selects hide their real input as a sliver inside a wider control; markers belong beside that control, not the sliver. */
function controlOf(element: HTMLElement): HTMLElement {
  const target = targetOf(element);
  if (target.getBoundingClientRect().width >= MIN_FIELD_WIDTH) return target;
  const control = target.closest<HTMLElement>('[class*="control" i], [role="combobox"]');
  if (control && control.getBoundingClientRect().width >= MIN_FIELD_WIDTH) return control;
  let anchor = target;
  for (let depth = 0; depth < 4 && anchor.parentElement && anchor.getBoundingClientRect().width < MIN_FIELD_WIDTH; depth++) anchor = anchor.parentElement;
  return anchor;
}

const MAX_FRAME_GROWTH = 5;

/** The outline the user sees around a field can belong to a wrapper (label and control share one box), so markers sit outside the nearest bordered ancestor. */
function anchorOf(element: HTMLElement): HTMLElement {
  const control = controlOf(element);
  const controlBox = control.getBoundingClientRect();
  for (let parent: HTMLElement | null = control, depth = 0; parent && parent !== document.body && depth < 6; parent = parent.parentElement, depth++) {
    const style = getComputedStyle(parent);
    const hasBorder = parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none" && style.borderTopColor !== "transparent" && style.borderTopColor !== "rgba(0, 0, 0, 0)";
    if (!hasBorder) continue;
    const box = parent.getBoundingClientRect();
    return box.width >= controlBox.width && box.height <= controlBox.height * MAX_FRAME_GROWTH ? parent : control;
  }
  return control;
}

export function mark(element: HTMLElement, kind: Mark): void {
  const target = targetOf(element);
  if (target.dataset.sjHighlight === undefined) target.dataset.sjPrevOutline = target.style.outline;
  target.dataset.sjHighlight = kind;
  target.style.outline = `2px solid ${COLORS[kind]}`;
  target.style.outlineOffset = "1px";
}

const SETTLE_POLL_MS = 16;
const SETTLE_MAX_MS = 1500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The element's own box, or the nearest ancestor that has one: a hidden native control is shown through its wrapper. */
function visibleBoxOwner(element: HTMLElement): HTMLElement | undefined {
  let owner: HTMLElement | null = anchorOf(element);
  for (let depth = 0; owner && depth < 4; depth++, owner = owner.parentElement) {
    const box = owner.getBoundingClientRect();
    if (box.width || box.height) return owner;
  }
  return undefined;
}

/** In the middle band of the window and of every scrolling container around it (a modal clips fields the window thinks are visible). */
function isComfortablyInView(target: HTMLElement): boolean {
  let top = innerHeight * 0.15;
  let bottom = innerHeight * 0.85;
  for (let parent = target.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) {
    if (getComputedStyle(parent).overflowY === "visible") continue;
    const box = parent.getBoundingClientRect();
    top = Math.max(top, box.top + box.height * 0.1);
    bottom = Math.min(bottom, box.bottom - box.height * 0.1);
  }
  const box = target.getBoundingClientRect();
  return box.top > top && box.bottom < bottom;
}

/** Smooth scrolling has no end event; wait until the element stops moving so the cursor lands where the field finally rests. */
async function waitUntilStill(target: HTMLElement): Promise<void> {
  let lastTop = Number.NaN;
  let stillPolls = 0;
  for (let waited = 0; waited < SETTLE_MAX_MS && stillPolls < 3; waited += SETTLE_POLL_MS) {
    await sleep(SETTLE_POLL_MS);
    const { top } = target.getBoundingClientRect();
    stillPolls = top === lastTop ? stillPolls + 1 : 0;
    lastTop = top;
  }
}

/** Scrolls a field into the middle of the page unless it is already comfortably in view; false when it has no box to show (hidden, or no layout). */
export async function reveal(element: HTMLElement): Promise<boolean> {
  const target = visibleBoxOwner(element);
  if (!target) return false;
  if (!isComfortablyInView(target)) {
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    await waitUntilStill(target);
  }
  return true;
}

// ---------- unanswered dots, the one-time "saved" note and the filling cursor ----------
// They live in a shadow root of their own: page frameworks re-render form markup and would wipe anything injected beside a field.

const LOGO = `<svg viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#f5620f"/><text x="32" y="32" dy="0.35em" text-anchor="middle" font-family="system-ui,sans-serif" font-size="34" font-weight="600" fill="#fff">S</text></svg>`;
const ARROW = `<svg viewBox="0 0 24 24"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a3d"/><stop offset="1" stop-color="#f5620f"/></linearGradient></defs><path d="M4 3l16 7.5-7 2.5-2.5 7z" fill="url(#g)" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

const LAYER_CSS = `
.dot{position:absolute;width:8px;height:8px;border-radius:50%;background:#f59e0b;opacity:.85;animation:rise .28s ease-out}
.dot.optional{background:#94a3b8}
.note{position:absolute;display:flex;align-items:center;gap:8px;width:max-content;max-width:260px;padding:7px 12px 7px 7px;border-radius:12px;background:#fff;color:#475569;
  border:1px solid #e2e8f0;box-shadow:0 4px 14px rgba(15,23,42,.12);font:500 12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;animation:rise .28s ease-out}
.note svg{flex:none;width:22px;height:22px}
.cursor{position:absolute;width:26px;height:26px;margin:-4px 0 0 -4px;transition:left .32s cubic-bezier(.4,0,.2,1),top .32s cubic-bezier(.4,0,.2,1),opacity .3s}
.cursor svg{width:100%;height:100%;display:block;filter:drop-shadow(0 3px 5px rgba(59,130,246,.45));animation:float 1.6s ease-in-out infinite}
.cursor i{position:absolute;left:4px;top:4px;width:10px;height:10px;border-radius:50%;border:2px solid #f5620f;opacity:0}
.cursor.tap i{animation:tap .45s ease-out}
@keyframes float{50%{transform:translate(2px,3px)}}
@keyframes tap{from{opacity:.8;transform:scale(.4)}to{opacity:0;transform:scale(2.6)}}
@keyframes rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;

const REPOSITION_MS = 500;
const CURSOR_MS = 320;
const GAP = 12;
const markers = new Map<HTMLElement, HTMLElement>();
let layerRoot: ShadowRoot | undefined;
let repositionTimer: ReturnType<typeof setInterval> | undefined;
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
  const box = anchorOf(element).getBoundingClientRect();
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

let isFrameQueued = false;

/** Scrolling a page or an inner panel moves fields every frame; waiting for the timer left dots drifting for a moment. */
function placeOnNextFrame(): void {
  if (isFrameQueued) return;
  isFrameQueued = true;
  requestAnimationFrame(() => {
    isFrameQueued = false;
    placeAll();
  });
}

function trackMovement(isTracking: boolean): void {
  const toggle = isTracking ? addEventListener : removeEventListener;
  // capture: scroll events from inner scrollable containers do not bubble
  toggle("scroll", placeOnNextFrame, { capture: true, passive: true });
  toggle("resize", placeOnNextFrame);
}

function show(element: HTMLElement, marker: HTMLElement): void {
  removeMarker(element);
  layer().append(marker);
  markers.set(element, marker);
  place(element, marker);
  if (repositionTimer === undefined) {
    repositionTimer = setInterval(placeAll, REPOSITION_MS);
    trackMovement(true);
  }
}

function showDot(element: HTMLElement, isRequired: boolean): void {
  const dot = document.createElement("div");
  dot.className = isRequired ? "dot" : "dot optional";
  show(element, dot);
}

function showTip(element: HTMLElement): void {
  const note = document.createElement("div");
  note.className = "note";
  note.innerHTML = `${LOGO}<span>SmartJob Assistant saves your answer for next time</span>`;
  show(element, note);
}

/** Fields SmartJob had no answer for, and whether each is required; they keep a dot until answered. */
const unknownFields = new Map<HTMLElement, boolean>();
let isFocusTracked = false;

/** While a dotted field has focus the dot gives way to a tip explaining that the answer is saved; it comes back if the field is left empty. */
function trackFocus(): void {
  if (isFocusTracked) return;
  isFocusTracked = true;
  document.addEventListener("focusin", (event) => {
    const element = event.target as HTMLElement;
    if (unknownFields.has(element)) showTip(element);
  }, true);
  document.addEventListener("focusout", (event) => {
    const element = event.target as HTMLElement;
    const isRequired = unknownFields.get(element);
    if (isRequired !== undefined) showDot(element, isRequired);
  }, true);
}

/** Pins a small dot beside a field SmartJob had no answer for. */
export function markUnknown(element: HTMLElement, isRequired: boolean): void {
  unknownFields.set(element, isRequired);
  showDot(element, isRequired);
  trackFocus();
}

/** The user answered a dot field: dot and tip go. */
export function answered(element: HTMLElement): void {
  release(element);
}

function removeMarker(element: HTMLElement): void {
  markers.get(element)?.remove();
  markers.delete(element);
  if (!markers.size) {
    clearInterval(repositionTimer);
    repositionTimer = undefined;
    trackMovement(false);
  }
}

/** Removes a field's dot or tip for good, e.g. once the user answered it or it was filled. */
export function release(element: HTMLElement): void {
  unknownFields.delete(element);
  removeMarker(element);
}

/** Glides the arrow cursor to a field being filled and waits for it to arrive. */
export async function moveCursor(element: HTMLElement): Promise<void> {
  const box = (visibleBoxOwner(element) ?? targetOf(element)).getBoundingClientRect();
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
