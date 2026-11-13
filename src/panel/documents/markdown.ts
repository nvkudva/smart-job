const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (text: string) => escape(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

/** Tiny markdown subset: # headings, - bullets, **bold**, paragraphs. All input is HTML-escaped first. */
export function toHtml(markdown: string): string {
  const out: string[] = [];
  let paragraph: string[] = [];
  let isInList = false;
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.join("<br>")}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (isInList) out.push("</ul>");
    isInList = false;
  };
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (!heading && !bullet) closeList();
    if (!line || heading || bullet) flushParagraph();
    if (heading) out.push(`<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`);
    else if (bullet) {
      if (!isInList) out.push("<ul>");
      isInList = true;
      out.push(`<li>${inline(bullet[1]!)}</li>`);
    } else if (line) paragraph.push(inline(line));
  }
  flushParagraph();
  closeList();
  return out.join("\n");
}

const printStyle = "body{font:11pt/1.4 Georgia,serif;max-width:7.5in;margin:0.5in auto;color:#111}h1{font-size:20pt;margin:0}h2{font-size:12pt;text-transform:uppercase;border-bottom:1px solid #999;margin:14pt 0 4pt}h3{font-size:11pt;margin:8pt 0 2pt}ul{margin:2pt 0;padding-left:18pt}p{margin:4pt 0}";

/** Opens a clean printable page and triggers the print dialog (Save as PDF). */
export function openPrintable(markdown: string, title: string): void {
  const html = `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><style>${printStyle}</style>${toHtml(markdown)}`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const printWindow = window.open(url, "_blank");
  // shortcut: fixed delay instead of load event (window.open returns before navigation); upgrade if print fires too early
  setTimeout(() => printWindow?.print(), 600);
}
