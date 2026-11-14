import type { ApplyClick } from "../messages.ts";

const APPLY_LABEL = /^((easy )?apply( now| here| today| online| externally| on (the )?company (site|website)| (for|to) (this|the) (job|role|position))?|i'?m interested)$/;
const CLICKABLE = "a[href], button, [role=button], input[type=button]";
const FORM_FIELDS = "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=search]), textarea, select";

const clean = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase().replace(/[\s→›»↗]+$/, "");

/** The visible text, else the aria-label: LinkedIn's label is "Easy Apply to <job> at <company>" while its text is "Easy Apply". */
function labelOf(element: HTMLElement): string {
  return clean((element as HTMLInputElement).value || element.textContent || element.getAttribute("aria-label") || "");
}

function isApply(element: HTMLElement): boolean {
  return APPLY_LABEL.test(labelOf(element)) || APPLY_LABEL.test(clean(element.getAttribute("aria-label") ?? "")) || /^easy apply to /.test(clean(element.getAttribute("aria-label") ?? ""));
}

// shortcut: checks display/hidden only, not off-screen or zero-size elements; upgrade if a site hides decoys that way.
function isVisible(element: HTMLElement): boolean {
  return !element.closest("[hidden]") && getComputedStyle(element).display !== "none";
}

/** A submit button inside a form with fields sends the application; the Apply we want only opens it. */
function isFormSubmit(element: HTMLElement): boolean {
  const form = element.closest("form");
  return !!form && !!form.querySelector(FORM_FIELDS);
}

function findApply(root: Document): HTMLElement | null {
  for (const element of root.querySelectorAll<HTMLElement>(CLICKABLE)) {
    if (!isApply(element) || !isVisible(element) || isFormSubmit(element)) continue;
    if (element instanceof HTMLAnchorElement && /^mailto:/i.test(element.getAttribute("href") ?? "")) continue;
    return element;
  }
  return null;
}

/**
 * Finds the job page's Apply control. A real link is returned for the panel to open (a click sent from the panel has no user
 * activation, so a page-opened tab would be popup-blocked); buttons are clicked here.
 */
export function click(root: Document = document): ApplyClick {
  const element = findApply(root);
  if (!element) return { result: "none" };
  const label = labelOf(element);
  if (element instanceof HTMLAnchorElement && /^https?:\/\//i.test(element.href) && !element.getAttribute("href")?.startsWith("#")) {
    return { result: "link", href: element.href, label };
  }
  element.click();
  return { result: "clicked", label };
}
