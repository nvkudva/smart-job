import { ALTERNATIVES_SEPARATOR } from "../../fill/mapping.ts";
import type { FieldDescriptor, FieldKind } from "../../types.ts";

const CANDIDATES =
  "input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=combobox], [role=radiogroup], button[aria-haspopup=listbox]";
const SKIPPED_INPUT_TYPES = new Set(["hidden", "submit", "button", "image", "reset", "search"]);
const PLACEHOLDER_TEXT = /^(select|choose|please|pick|-+|—|…|\.\.\.)/i;

let idCounter = 0;

const DIALOG = '[role=dialog], dialog[open], .artdeco-modal, .jobs-easy-apply-modal';

/** An open modal (LinkedIn Easy Apply) owns the form; fields behind it on the page must not be scanned or filled. */
function openDialog(): HTMLElement | null {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>(DIALOG)).filter((dialog) => !dialog.closest("[hidden]") && getComputedStyle(dialog).display !== "none");
  return dialogs.at(-1) ?? null;
}

/** Scan visible fillable fields in this frame; stamps data-sj-id on each element. */
export function scan(): FieldDescriptor[] {
  const fields: FieldDescriptor[] = [];
  const seenGroups = new Set<string>();
  for (const element of (openDialog() ?? document).querySelectorAll<HTMLElement>(CANDIDATES)) {
    const field = describe(element, seenGroups);
    if (field) fields.push(field);
  }
  return fields;
}

export function findElement(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-sj-id="${id}"]`);
}

/** Radios sharing a name inside the same form (or document). */
export function radioGroup(input: HTMLInputElement): HTMLInputElement[] {
  const root: ParentNode = input.form ?? document;
  if (!input.name) return [input];
  return Array.from(root.querySelectorAll<HTMLInputElement>("input[type=radio]")).filter((radio) => radio.name === input.name);
}

export function kindOf(element: HTMLElement): FieldKind | null {
  if (element.matches("[role=radiogroup]")) return "radio";
  if (element instanceof HTMLTextAreaElement) return "textarea";
  if (element instanceof HTMLSelectElement) return "select";
  if (element instanceof HTMLInputElement) return inputKind(element);
  if (element instanceof HTMLButtonElement) return "combobox";
  if (element.getAttribute("role") === "combobox") return element.querySelector("input") ? null : "combobox";
  if (element.isContentEditable || element.getAttribute("contenteditable") !== null) return element.parentElement?.isContentEditable ? null : "contenteditable";
  return null;
}

function inputKind(input: HTMLInputElement): FieldKind | null {
  const type = input.type.toLowerCase();
  if (SKIPPED_INPUT_TYPES.has(type)) return null;
  if (type === "file" || type === "radio" || type === "checkbox" || type === "password") return type;
  if (type === "email" || type === "tel" || type === "number" || type === "url") return type;
  if (type === "date" || type === "month" || type === "datetime-local") return "date";
  if (isComboboxInput(input)) return "combobox";
  return looksLikeDateInput(input) ? "date" : "text";
}

function isComboboxInput(input: HTMLInputElement): boolean {
  return input.getAttribute("role") === "combobox" || input.getAttribute("aria-haspopup") === "listbox" || !!input.closest("[role=combobox]");
}

function looksLikeDateInput(input: HTMLInputElement): boolean {
  return /^(mm|dd|yyyy)\b/i.test(input.placeholder) || /dateSection/i.test(automationIdOf(input));
}

function automationIdOf(element: HTMLElement): string {
  return element.getAttribute("data-automation-id") ?? "";
}

function describe(element: HTMLElement, seenGroups: Set<string>): FieldDescriptor | null {
  const kind = kindOf(element);
  if (!kind || isExcluded(element, kind)) return null;
  const group = groupOptions(element, kind);
  if (element instanceof HTMLInputElement && group && element.name) {
    const key = `${kind}:${element.form ? "f" : "d"}:${element.name}`;
    if (seenGroups.has(key)) return null;
    seenGroups.add(key);
  }
  const rawLabel = group ? groupLabel(element) : fieldLabel(element);
  if (isHoneypot(element, rawLabel)) return null;
  return {
    id: stamp(element),
    frameId: 0, // overwritten by the panel with the real frame id
    kind,
    label: cleanLabel(rawLabel),
    name: element.getAttribute("name") ?? element.id,
    placeholder: element.getAttribute("placeholder") ?? "",
    automationId: automationIdOf(element) || (element.closest('[data-automation-id^="formField"]')?.getAttribute("data-automation-id") ?? ""),
    required: isRequired(element, rawLabel, group),
    options: group?.map((option) => option.label) ?? optionTexts(element, kind),
    // the scan is shown in the panel and copied into bug reports, so never carry a typed password
    currentValue: kind === "password" && readValue(element, kind) ? "********" : readValue(element, kind),
    section: cleanLabel(sectionOf(element, !!group)),
  };
}

function stamp(element: HTMLElement): string {
  element.dataset.sjId ??= `sj-${++idCounter}`;
  return element.dataset.sjId;
}

// ---------- visibility / exclusion ----------

function hasLayout(): boolean {
  // happy-dom reports zero-size boxes everywhere; only trust geometry in a real browser
  return document.documentElement.getBoundingClientRect().width > 0;
}

function isVisible(element: HTMLElement, ignoreSelf: boolean): boolean {
  for (let node: HTMLElement | null = ignoreSelf ? element.parentElement : element; node; node = node.parentElement) {
    if (node.hidden) return false;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  if (ignoreSelf || !hasLayout()) return true;
  const box = element.getBoundingClientRect();
  return box.width > 0 || box.height > 0;
}

const HONEYPOT_TEXT = /for robots|if you(?:'|’| a)re (?:a )?human|honeypot/i;

/** Anti-bot trap fields (Workday "beecatcher"): filling one flags the application as spam. */
function isHoneypot(element: HTMLElement, label: string): boolean {
  return HONEYPOT_TEXT.test(label) || /beecatcher|honeypot/i.test(automationIdOf(element) + (element.getAttribute("name") ?? ""));
}

function isExcluded(element: HTMLElement, kind: FieldKind): boolean {
  if (element.closest("header, nav, [role=search], [role=banner], [role=navigation]")) return true;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    if (element.disabled) return true;
    if ("readOnly" in element && element.readOnly && kind !== "combobox") return true;
  }
  if (element.getAttribute("aria-hidden") === "true" && element.getAttribute("tabindex") === "-1" && kind !== "file") return true; // react-select's shadow "required" input
  if (kind === "file") return false; // triggers are often elsewhere and the input sits in a hidden wrapper
  if (element instanceof HTMLButtonElement && (element.disabled || element.getAttribute("aria-haspopup") !== "listbox")) return true;
  const isCustomControl = kind === "radio" || kind === "checkbox";
  return !isVisible(element, isCustomControl);
}

function isRequired(element: HTMLElement, rawLabel: string, group: { label: string }[] | null): boolean {
  if (element.getAttribute("aria-required") === "true") return true;
  if ("required" in element && (element as HTMLInputElement).required) return true;
  if (group && element.closest("fieldset, [role=radiogroup]")?.querySelector("[required], [aria-required=true]")) return true;
  return /[*✱]|\(required\)/i.test(rawLabel);
}

// ---------- values and options ----------

export function readValue(element: HTMLElement, kind: FieldKind = kindOf(element) ?? "text"): string {
  if (element instanceof HTMLSelectElement) return selectedOptionText(element);
  if (kind === "radio") return checkedLabel(element);
  if (element instanceof HTMLInputElement && kind === "checkbox") return checkboxValue(element);
  if (element instanceof HTMLInputElement && kind === "file") return Array.from(element.files ?? []).map((file) => file.name).join(", ");
  if (element instanceof HTMLInputElement && kind === "combobox") return element.value || comboboxText(element);
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
  return kind === "combobox" && PLACEHOLDER_TEXT.test(text) ? "" : text;
}

/** react-select keeps the chosen value in a sibling of its search input, not in the input itself. */
function comboboxText(input: HTMLElement): string {
  const container = input.closest("[class*=value-container], [class*=control]");
  const text = container ? visibleText(container) : "";
  return PLACEHOLDER_TEXT.test(text) ? "" : text;
}

function selectedOptionText(select: HTMLSelectElement): string {
  const option = select.options[select.selectedIndex];
  if (!option || (!option.value && select.selectedIndex === 0)) return "";
  const text = option.textContent?.trim() ?? "";
  return PLACEHOLDER_TEXT.test(text) ? "" : text;
}

function checkboxValue(box: HTMLInputElement): string {
  const members = sameNameCheckboxes(box);
  if (members.length < 2) return String(box.checked);
  return members.filter((member) => member.checked).map((member) => cleanLabel(optionLabel(member))).join(ALTERNATIVES_SEPARATOR);
}

function checkedLabel(element: HTMLElement): string {
  const options = element instanceof HTMLInputElement ? radioGroup(element) : Array.from(element.querySelectorAll<HTMLElement>("[role=radio]"));
  const checked = options.find((option) => (option instanceof HTMLInputElement ? option.checked : option.getAttribute("aria-checked") === "true"));
  return checked ? cleanLabel(optionLabel(checked)) : "";
}

function optionTexts(element: HTMLElement, kind: FieldKind): string[] {
  if (element instanceof HTMLSelectElement) {
    return Array.from(element.options)
      .filter((option) => option.value !== "")
      .map((option) => option.textContent?.trim() ?? "")
      .filter((text) => text && !PLACEHOLDER_TEXT.test(text));
  }
  if (kind !== "combobox") return [];
  const listbox = document.getElementById(element.getAttribute("aria-controls") ?? element.getAttribute("aria-owns") ?? "");
  const options = listbox?.querySelectorAll<HTMLElement>("[role=option]") ?? [];
  return Array.from(options).map((option) => option.textContent?.trim() ?? "").filter(Boolean);
}

/** Radio / checkbox groups as { label, element } options; null for single controls. */
function groupOptions(element: HTMLElement, kind: FieldKind): { label: string }[] | null {
  if (element.matches("[role=radiogroup]")) {
    return Array.from(element.querySelectorAll<HTMLElement>("[role=radio]")).map((radio) => ({ label: cleanLabel(optionLabel(radio)) }));
  }
  if (!(element instanceof HTMLInputElement) || (kind !== "radio" && kind !== "checkbox")) return null;
  const members = kind === "radio" ? radioGroup(element) : sameNameCheckboxes(element);
  if (kind === "checkbox" && members.length < 2) return null;
  return members.map((member) => ({ label: cleanLabel(optionLabel(member)) }));
}

export function sameNameCheckboxes(input: HTMLInputElement): HTMLInputElement[] {
  if (!input.name) return [input];
  const root: ParentNode = input.form ?? document;
  return Array.from(root.querySelectorAll<HTMLInputElement>("input[type=checkbox]")).filter((box) => box.name === input.name);
}

export function optionLabel(option: HTMLElement): string {
  return (
    labelElementText(option) ||
    option.getAttribute("aria-label") ||
    (option.getAttribute("role") === "radio" ? option.textContent ?? "" : "") ||
    option.nextSibling?.textContent ||
    (option as HTMLInputElement).value ||
    ""
  );
}

// ---------- labels ----------

const MAX_LABEL = 300;
const CONTROLS = "input, select, textarea, button, [role=listbox]";
// live regions and alerts hold validation / "no results" noise, never the question text
const NOISE = "[aria-live], [role=alert], [role=status], [role=log], script, style, template, svg";
const GENERIC_FILE_LABEL = /^(attach|browse|choose|upload|select|add)\b[\w\s/-]{0,20}$/i;

function cleanLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/[*✱]|\(required\)/gi, "").replace(/:\s*$/, "").trim().slice(0, MAX_LABEL);
}

function isHiddenNode(node: HTMLElement): boolean {
  if (node.hidden) return true;
  const style = getComputedStyle(node);
  return style.display === "none" || style.visibility === "hidden";
}

/** Visible text of a node, skipping hidden / live-region subtrees and controls; optionally ends at the first control. */
function visibleText(root: Node, stopAtControl = false): string {
  let text = "";
  let stopped = false;
  const walk = (node: Node) => {
    if (stopped) return;
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";
    if (!(node instanceof HTMLElement) || node.matches(NOISE) || isHiddenNode(node)) return;
    if (node !== root && node.matches(CONTROLS)) stopped = stopAtControl;
    else if (node.tagName === "BR") text += " ";
    else node.childNodes.forEach(walk);
  };
  walk(root);
  return text.replace(/\s+/g, " ").trim();
}

/** Text of a wrapping <label>: its label-like child (Lever `.application-label`), else the text before the control. */
function wrappedLabelText(label: Element): string {
  const heading = Array.from(label.querySelectorAll("[class]")).find((child) => /label/i.test(child.getAttribute("class") ?? ""));
  return (heading && visibleText(heading)) || visibleText(label, true) || visibleText(label);
}

function labelElementText(element: HTMLElement): string {
  if (element.id) {
    const forLabel = Array.from(document.querySelectorAll("label[for]")).find((label) => label.getAttribute("for") === element.id);
    if (forLabel) return wrappedLabelText(forLabel);
  }
  const wrapping = element.closest("label");
  return wrapping ? wrappedLabelText(wrapping) : "";
}

function labelledByText(element: Element): string {
  const ids = element.getAttribute("aria-labelledby")?.split(/\s+/).filter(Boolean) ?? [];
  return ids.map((id) => document.getElementById(id)).filter((target) => !!target).map((target) => visibleText(target)).join(" ").trim();
}

function humanizeAutomationId(id: string): string {
  const tail = id.includes("_") ? id.slice(id.lastIndexOf("_") + 1) : id.replace(/^formField-/, "");
  return tail.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").trim();
}

function dateSectionLabel(element: HTMLElement): string {
  if (!/^dateSection/i.test(automationIdOf(element))) return "";
  const wrapper = element.closest('[data-automation-id^="formField"]');
  const label = wrapper?.querySelector("label");
  return label ? visibleText(label, true) : "";
}

/** File inputs are usually labelled "Attach" / "Browse"; the real name ("Resume/CV", "Cover Letter") is on the group around them. */
function fileGroupLabel(element: HTMLElement): string {
  const group = element.closest("[role=group][aria-labelledby]");
  const own = labelElementText(element);
  return group && (!own || GENERIC_FILE_LABEL.test(own.trim())) ? labelledByText(group) : "";
}

function fieldLabel(element: HTMLElement): string {
  const automationId = automationIdOf(element);
  return (
    dateSectionLabel(element) ||
    (element.getAttribute("type") === "file" ? fileGroupLabel(element) : "") ||
    labelElementText(element) ||
    labelledByText(element) ||
    element.getAttribute("aria-label") ||
    (automationId ? humanizeAutomationId(automationId) : "") ||
    nearestText(element) ||
    element.getAttribute("placeholder") ||
    ""
  );
}

function legendOf(group: Element): string {
  const legend = Array.from(group.children).find((child) => child.tagName === "LEGEND");
  return (legend && visibleText(legend)) || labelledByText(group) || group.getAttribute("aria-label") || "";
}

function groupLabel(element: HTMLElement): string {
  const container = element.matches("[role=radiogroup]") ? element : element.closest("fieldset, [role=radiogroup], [role=group]");
  return (container && legendOf(container)) || nearestText(container ?? element);
}

/** True when the container also holds controls that are not part of `own` (its name-sharing group or descendants). */
function holdsOtherControls(container: Element, own: Element): boolean {
  const name = own.getAttribute("name");
  return Array.from(container.querySelectorAll("input:not([type=hidden]), select, textarea")).some(
    (control) => control !== own && !own.contains(control) && control.getAttribute("aria-hidden") !== "true" && !(name && control.getAttribute("name") === name),
  );
}

/**
 * Nearest short text before the control. Climbs only while the parent belongs to this control alone, so the text
 * found is this question's own heading (Lever `.application-label`) and never a neighbouring question's.
 */
function nearestText(start: Element): string {
  let node: Element | null = start;
  for (let depth = 0; node && depth < 7; depth++, node = node.parentElement) {
    for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (sibling.matches(CONTROLS) || sibling.querySelector("input, select, textarea")) break; // text further up belongs to that control
      const text = visibleText(sibling);
      if (text && text.length <= 400) return text;
    }
    if (!node.parentElement || node.parentElement === document.body || holdsOtherControls(node.parentElement, start)) break;
  }
  return "";
}

// ---------- section ----------

const HEADING = "h1, h2, h3, h4, [role=heading], legend, [data-automation-id*=Header]";

function sectionOf(element: HTMLElement, isGroup: boolean): string {
  let node = isGroup ? (element.closest("fieldset, [role=radiogroup], [role=group]")?.parentElement ?? element.parentElement) : element.parentElement;
  for (; node && node !== document.body; node = node.parentElement) {
    const heading = Array.from(node.children).find((child) => child.matches(HEADING) && precedes(child, element));
    if (heading) return heading.textContent ?? "";
    if (node.matches('[data-automation-id*="Section"], fieldset') && node.getAttribute("aria-label")) return node.getAttribute("aria-label") ?? "";
  }
  const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4")).filter((heading) => precedes(heading, element));
  return headings.at(-1)?.textContent ?? "";
}

function precedes(candidate: Element, element: Element): boolean {
  return !candidate.contains(element) && !!(candidate.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
}
