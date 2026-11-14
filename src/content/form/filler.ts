import * as mapping from "../../fill/mapping.ts";
import type { FieldFill, FillResult } from "../../types.ts";
import * as scanner from "./scanner.ts";

type ResumeFile = { name: string; base64: string; mimeType: string };

const pickedText = new WeakMap<HTMLElement, string>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface FillHooks {
  before?: (fill: FieldFill) => Promise<void>;
  after?: (fill: FieldFill, result: FillResult) => void;
}

/** Fill sequentially with short pauses so frameworks can re-render between fields. */
export async function fillAll(fills: FieldFill[], resumeFile?: ResumeFile, hooks: FillHooks = {}): Promise<FillResult[]> {
  const results: FillResult[] = [];
  for (const fill of fills) {
    await hooks.before?.(fill);
    const result = await fillOne(fill, resumeFile);
    results.push(result);
    hooks.after?.(fill, result);
    await sleep(40);
  }
  return results;
}

async function fillOne(fill: FieldFill, resumeFile?: ResumeFile): Promise<FillResult> {
  const element = scanner.findElement(fill.id);
  if (!element) return { id: fill.id, ok: false, finalValue: "", error: "field not found" };
  const kind = scanner.kindOf(element);
  if (!kind) return { id: fill.id, ok: false, finalValue: "", error: "unsupported element" };
  try {
    const error = await fillKind(element, kind, fill.value, resumeFile);
    // react-select style inputs clear their text after picking, so fall back to what we clicked
    const finalValue = scanner.readValue(element, kind) || pickedText.get(element) || "";
    return { id: fill.id, ok: !error && isFilled(element, kind, finalValue, fill.value), finalValue, error: error ?? "" };
  } catch (cause) {
    return { id: fill.id, ok: false, finalValue: scanner.readValue(element, kind), error: String(cause) };
  }
}

function isFilled(element: HTMLElement, kind: string, finalValue: string, wanted: string): boolean {
  const isSingleCheckbox = kind === "checkbox" && scanner.sameNameCheckboxes(element as HTMLInputElement).length < 2;
  if (isSingleCheckbox) return finalValue === String(isTruthy(wanted));
  return finalValue.trim() !== "";
}

const isTruthy = (value: string) => /^(true|yes|y|1|checked)$/i.test(value.trim());

/** Returns an error message, or undefined on success. */
async function fillKind(element: HTMLElement, kind: string, value: string, resumeFile?: ResumeFile): Promise<string | undefined> {
  switch (kind) {
    case "select":
      return fillSelect(element as HTMLSelectElement, value);
    case "radio":
      return fillChoiceGroup(element, value);
    case "checkbox":
      return fillCheckbox(element as HTMLInputElement, value);
    case "combobox":
      return fillCombobox(element, value);
    case "file":
      return fillFile(element as HTMLInputElement, resumeFile);
    case "contenteditable":
      return fillContentEditable(element, value);
    case "date":
      return fillTextLike(element as HTMLInputElement, formatDate(element as HTMLInputElement, value));
    default:
      return fillTextLike(element as HTMLInputElement | HTMLTextAreaElement, value);
  }
}

// ---------- events ----------

function dispatch(element: Element, type: string, init: EventInit = { bubbles: true }): void {
  const event = type === "input" ? new InputEvent(type, { bubbles: true, inputType: "insertText" }) : new Event(type, init);
  element.dispatchEvent(event);
}

// native focus/blur keep document.activeElement right; synthetic events cover pages without window focus
function focusElement(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  dispatch(element, "focus", { bubbles: false });
  dispatch(element, "focusin");
}

function blurElement(element: HTMLElement): void {
  dispatch(element, "blur", { bubbles: false });
  dispatch(element, "focusout");
  element.blur();
}

/** pointer + mouse + click sequence; React/Workday listen to more than `click`. */
function clickLike(element: HTMLElement): void {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
  element.click();
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
}

// ---------- text-like ----------

async function fillTextLike(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<string | undefined> {
  focusElement(element);
  setNativeValue(element, value);
  dispatch(element, "input");
  if (/dateSection/i.test(automationIdOf(element))) pressKey(element, value.slice(-1)); // spinbutton inputs expect key events
  if (isTypeahead(element)) await pickSuggestion(element, value);
  dispatch(element, "change");
  blurElement(element);
  return undefined;
}

const TYPEAHEAD_HINT = /(^|[^a-z])(location|city)($|[^a-z])/i;
const SUGGESTION_SELECTOR = '[role=option], .pac-item, [class*=suggestion], [class*=dropdown-location], [class*=dropdown-result] > *';

function isTypeahead(element: HTMLElement): element is HTMLInputElement {
  if (!(element instanceof HTMLInputElement)) return false;
  const hints = [element.name, element.id, element.className, element.getAttribute("data-qa") ?? ""].join(" ");
  return TYPEAHEAD_HINT.test(hints) || element.getAttribute("aria-autocomplete") === "list";
}

/** Type-ahead inputs (Lever location) only count a value picked from their suggestion list. */
async function pickSuggestion(input: HTMLInputElement, value: string): Promise<void> {
  const queries = [...new Set([value, value.split(",")[0]?.trim() ?? ""])].filter(Boolean);
  for (const query of queries) {
    setNativeValue(input, query);
    dispatch(input, "input");
    pressKey(input, "End"); // some widgets (Lever) only search on keyup
    const suggestion = (await waitForOptions(1500, SUGGESTION_SELECTOR, input))[0];
    if (!suggestion) continue;
    clickLike(suggestion);
    await sleep(100);
    return;
  }
  setNativeValue(input, value); // no suggestion appeared: keep what the user would have typed
  dispatch(input, "input");
}

function fillContentEditable(element: HTMLElement, value: string): string | undefined {
  focusElement(element);
  element.textContent = value;
  dispatch(element, "input");
  blurElement(element);
  return undefined;
}

// ---------- dates ----------

function splitYearMonth(value: string): { year: string; month: string; day: string } | null {
  const iso = value.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (iso) return { year: iso[1]!, month: iso[2] ?? "", day: iso[3] ?? "" };
  const slash = value.match(/^(\d{1,2})\/(\d{4})$/);
  return slash ? { year: slash[2]!, month: slash[1]!.padStart(2, "0"), day: "" } : null;
}

function formatDate(input: HTMLInputElement, value: string): string {
  const parts = splitYearMonth(value);
  if (!parts) return value;
  const month = parts.month || "01";
  const day = parts.day || "01";
  const automationId = input.getAttribute("data-automation-id") ?? "";
  if (/dateSectionMonth/i.test(automationId)) return month;
  if (/dateSectionDay/i.test(automationId)) return day;
  if (/dateSectionYear/i.test(automationId)) return parts.year;
  if (input.type === "date") return `${parts.year}-${month}-${day}`;
  if (input.type === "month") return `${parts.year}-${month}`;
  const hint = input.placeholder.toUpperCase();
  if (hint === "YYYY") return parts.year;
  if (hint.startsWith("YYYY")) return `${parts.year}-${month}-${day}`;
  if (hint.startsWith("MM/DD")) return `${month}/${day}/${parts.year}`;
  if (hint.startsWith("DD/MM")) return `${day}/${month}/${parts.year}`;
  return `${month}/${parts.year}`;
}

// ---------- select / radio / checkbox ----------

function fillSelect(select: HTMLSelectElement, value: string): string | undefined {
  const options = Array.from(select.options);
  const texts = options.map((option) => option.textContent?.trim() ?? "");
  const wanted = mapping.matchOption(texts, value);
  const option = wanted === undefined ? undefined : options[texts.indexOf(wanted)];
  if (!option) return `no option matches "${value}"`;
  focusElement(select);
  setNativeValue(select, option.value);
  dispatch(select, "input");
  dispatch(select, "change");
  blurElement(select);
  return undefined;
}

function choiceElements(element: HTMLElement): HTMLElement[] {
  if (element instanceof HTMLInputElement) return element.type === "radio" ? scanner.radioGroup(element) : scanner.sameNameCheckboxes(element);
  return Array.from(element.querySelectorAll<HTMLElement>("[role=radio]"));
}

function fillChoiceGroup(element: HTMLElement, value: string): string | undefined {
  const choices = choiceElements(element);
  const labels = choices.map((choice) => scanner.optionLabel(choice).replace(/\s+/g, " ").replace(/\*/g, "").trim());
  const isMulti = element instanceof HTMLInputElement && element.type === "checkbox"; // checkbox groups take every listed option
  const wantedValues = isMulti ? value.split(mapping.ALTERNATIVES_SEPARATOR) : [value];
  const picked = wantedValues.map((wanted) => mapping.matchOption(labels, wanted)).flatMap((label) => (label === undefined ? [] : [choices[labels.indexOf(label)]!]));
  if (!picked.length) return `no option matches "${value}"`;
  for (const choice of picked) {
    if (!isChecked(choice)) clickChoice(choice);
    if (!isChecked(choice)) return "could not select option";
  }
  return undefined;
}

const isChecked = (choice: HTMLElement) => (choice instanceof HTMLInputElement ? choice.checked : choice.getAttribute("aria-checked") === "true");

function clickChoice(choice: HTMLElement): void {
  clickLike(choice);
  if (isChecked(choice)) return;
  const label = choice.closest("label") ?? (choice.id ? document.querySelector<HTMLElement>(`label[for="${choice.id}"]`) : null);
  label?.click();
}

function fillCheckbox(box: HTMLInputElement, value: string): string | undefined {
  if (scanner.sameNameCheckboxes(box).length > 1) return fillChoiceGroup(box, value);
  if (box.checked === isTruthy(value)) return undefined;
  clickChoice(box);
  return box.checked === isTruthy(value) ? undefined : "could not toggle checkbox";
}

// ---------- combobox / custom dropdown ----------

const OPTION_SELECTOR = '[role=option], [data-automation-id=promptOption], [data-automation-id=menuItem]';

function visibleOptions(selector = OPTION_SELECTOR): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((option) => {
    if (option.hidden) return false;
    for (let node: HTMLElement | null = option; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  });
}

/** Options of the menu that belongs to `owner`: another dropdown left open on the page must not be clicked by mistake. */
function ownOptions(owner: HTMLElement | undefined, options: HTMLElement[]): HTMLElement[] {
  if (!owner) return options;
  const controlled = document.getElementById(owner.getAttribute("aria-controls") ?? "");
  if (controlled) return options.filter((option) => controlled.contains(option));
  let node = owner.parentElement;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    const holder = node;
    const inside = options.filter((option) => holder.contains(option));
    if (inside.length) return inside;
  }
  return options;
}

async function waitForOptions(timeoutMs = 1500, selector = OPTION_SELECTOR, owner?: HTMLElement): Promise<HTMLElement[]> {
  const deadline = Date.now() + timeoutMs;
  let options = ownOptions(owner, visibleOptions(selector));
  while (!options.length && Date.now() < deadline) {
    await sleep(50);
    options = ownOptions(owner, visibleOptions(selector));
  }
  return options;
}

const optionText = (option: HTMLElement) => (option.getAttribute("data-automation-label") ?? option.textContent ?? "").replace(/\s+/g, " ").trim();

/** The search box inside the popup that is open for `element`; pages can hold other search inputs (multiselects). */
function popupSearchInput(element: HTMLElement, options: HTMLElement[]): HTMLInputElement | null {
  if (element instanceof HTMLInputElement) return element;
  let node = options[0]?.parentElement ?? null;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    const input = node.querySelector("input");
    if (input) return input;
  }
  return document.querySelector<HTMLInputElement>('[role=listbox] input, [data-automation-id=searchBox] input, input[data-automation-id=searchBox]');
}

function typeInto(input: HTMLInputElement, value: string): void {
  setNativeValue(input, value);
  dispatch(input, "input");
  if (automationIdOf(input) === "searchBox") pressKey(input, "Enter"); // Workday multiselects only search on Enter
}

const automationIdOf = (element: HTMLElement) => element.getAttribute("data-automation-id") ?? "";

function pressKey(element: HTMLElement, key: string): void {
  for (const type of ["keydown", "keyup"]) element.dispatchEvent(new KeyboardEvent(type, { key, code: key, bubbles: true }));
}

function closeDropdown(element: HTMLElement): void {
  for (const target of [element, document.body]) {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  }
}

async function pickOption(options: HTMLElement[], value: string): Promise<HTMLElement | undefined> {
  const texts = options.map(optionText);
  const wanted = mapping.matchOption(texts, value);
  return wanted === undefined ? undefined : options[texts.indexOf(wanted)];
}

async function pickFromAny(options: HTMLElement[], candidates: string[]): Promise<HTMLElement | undefined> {
  for (const candidate of candidates) {
    const target = await pickOption(options, candidate);
    if (target) return target;
  }
  return undefined;
}

/** Search queries to narrow a long list: full value, first two words, first word. */
function searchQueries(candidate: string): string[] {
  const words = candidate.split(/\s+/);
  return [...new Set([candidate, words.slice(0, 2).join(" "), words[0] ?? ""])].filter(Boolean);
}

async function fillCombobox(element: HTMLElement, value: string): Promise<string | undefined> {
  const candidates = value.split(mapping.ALTERNATIVES_SEPARATOR);
  document.activeElement instanceof HTMLElement && document.activeElement !== element && blurElement(document.activeElement);
  focusElement(element);
  clickLike(element);
  let options = await waitForOptions(1500, OPTION_SELECTOR, element);
  let target = await pickFromAny(options, candidates);
  const search = target ? null : popupSearchInput(element, options);
  if (search) {
    for (const query of searchQueries(candidates[0] ?? value)) {
      typeInto(search, query);
      await sleep(250); // let the filtered list render
      options = await waitForOptions(800, OPTION_SELECTOR, element);
      target = await pickFromAny(options, candidates);
      if (target) break;
    }
  }
  if (!target) {
    closeDropdown(element);
    return options.length ? `no option matches "${value}"` : "dropdown did not open";
  }
  pickedText.set(element, optionText(target));
  clickLike(target);
  await sleep(120);
  if (visibleOptions().length) closeDropdown(element);
  blurElement(element);
  return undefined;
}

// ---------- file ----------

function fillFile(input: HTMLInputElement, resumeFile?: ResumeFile): string | undefined {
  if (!resumeFile?.base64) return "no resume file available";
  const bytes = Uint8Array.from(atob(resumeFile.base64), (char) => char.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], resumeFile.name, { type: resumeFile.mimeType }));
  input.files = transfer.files;
  dispatch(input, "input");
  dispatch(input, "change");
  return input.files.length === 1 ? undefined : "file was not attached";
}
