const blockSelector = "p, li, div, h1, h2, h3, h4, h5, h6, tr";

/** Text of an element with one line per block or <br>, bullets and spacing kept readable. */
export function block(root: Element): string {
  const copy = root.cloneNode(true) as Element;
  for (const lineBreak of copy.querySelectorAll("br")) lineBreak.replaceWith("\n");
  for (const section of copy.querySelectorAll(blockSelector)) section.append("\n");
  return (copy.textContent ?? "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Text of an element on a single line; "" when the element is missing. */
export function line(element: Element | null | undefined): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}
