/** Turns a plain-text job description into display blocks. Display only: the raw text stays what the analysis reads. */

export type Block =
  | { kind: "heading"; text: string }
  | { kind: "field"; label: string; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "tags"; items: string[] };

export interface Segment {
  text: string;
  /** set when this piece is a highlighted term */
  tone?: "match" | "miss";
}

export interface Term {
  pattern: RegExp;
  tone: "match" | "miss";
}

const bulletPattern = /^(?:[•●▪◦‣∙·*\-–—]|\d{1,2}[.)])\s*/;
const abbreviations = /\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|Inc|Ltd|Co|No|approx|incl|Sr|Jr)\.$/i;
const longLineChars = 220;
const smallWords = new Set(["a", "an", "and", "as", "at", "for", "in", "of", "on", "or", "the", "to", "with", "&", "/", "-"]);

function isHeading(line: string): boolean {
  if (/:$/.test(line)) return line.length <= 140;
  if (line.length > 60 || line.length < 3) return false;
  const words = line.split(/\s+/);
  if (words.length > 6 || /[.!?,;)]$/.test(line)) return false;
  return words.every((word) => smallWords.has(word.toLowerCase()) || /^[\p{Lu}\d&]/u.test(word));
}

function asField(line: string): { label: string; text: string } | null {
  const match = /^([\p{L}][\p{L} /&]{1,28}):\s+(.{1,80})$/u.exec(line);
  if (!match || /[.!?]$/.test(match[2]!)) return null;
  return { label: match[1]!, text: match[2]! };
}

function asTags(line: string): string[] | null {
  const items = line.split(/\s*,\s*/).map((item) => item.replace(/^["'“”]+|["'“”]+$/g, "").trim()).filter(Boolean);
  if (items.length < 4 || /[.!?]$/.test(line)) return null;
  const isTag = (item: string) => item.length <= 32 && item.split(/\s+/).length <= 4 && /\p{L}.*\p{L}/u.test(item) && !/^\d/.test(item);
  return items.every(isTag) ? items : null;
}

/** Splits on sentence ends, never inside "Node.js", "3.5" or after "e.g.". */
export function sentences(text: string): string[] {
  const pieces = text.split(/(?<=[.!?])\s+(?=["“(]?[\p{Lu}\d])/u);
  const merged: string[] = [];
  for (const piece of pieces) {
    const last = merged.at(-1);
    if (last !== undefined && abbreviations.test(last)) merged[merged.length - 1] = `${last} ${piece}`;
    else merged.push(piece);
  }
  return merged.map((sentence) => sentence.trim()).filter(Boolean);
}

function pushBullets(blocks: Block[], items: string[]): void {
  const last = blocks.at(-1);
  if (last?.kind === "bullets") last.items.push(...items);
  else blocks.push({ kind: "bullets", items: [...items] });
}

/** "Num Positions" then a lone "2" under it reads as one "Num Positions: 2" field. */
function withFields(input: Block[]): Block[] {
  const output: Block[] = [];
  for (let index = 0; index < input.length; index++) {
    const block = input[index]!;
    const next = input[index + 1];
    const after = input[index + 2];
    const isLoneValue = next?.kind === "bullets" && next.items.length === 1 && next.items[0]!.length <= 80;
    if (block.kind === "heading" && isLoneValue && (!after || after.kind === "heading")) {
      output.push({ kind: "field", label: block.text, text: next.items[0]! });
      index++;
    } else output.push(block);
  }
  return output;
}

/** Line by line: bullet glyphs become list items, short title lines become headings, text under a heading becomes bullets. */
export function blocks(text: string): Block[] {
  const result: Block[] = [];
  let isUnderHeading = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (bulletPattern.test(line) && line.replace(bulletPattern, "").length > 1) {
      pushBullets(result, [line.replace(bulletPattern, "")]);
      continue;
    }
    const field = asField(line);
    if (field) {
      result.push({ kind: "field", ...field });
      continue;
    }
    const tags = asTags(line);
    if (tags) {
      result.push({ kind: "tags", items: tags });
      continue;
    }
    if (isHeading(line)) {
      result.push({ kind: "heading", text: line.replace(/:$/, "") });
      isUnderHeading = true;
      continue;
    }
    if (isUnderHeading) pushBullets(result, line.length > longLineChars ? sentences(line) : [line]);
    else result.push({ kind: "paragraph", text: line });
  }
  return withFields(result);
}

/** Cuts text into plain and highlighted pieces; where terms overlap the longer match wins ("JavaScript" over "Java"). */
export function highlight(text: string, terms: Term[]): Segment[] {
  const found: { start: number; end: number; tone: Term["tone"] }[] = [];
  for (const term of terms) {
    term.pattern.lastIndex = 0;
    for (const match of text.matchAll(term.pattern)) {
      if (match[0]) found.push({ start: match.index, end: match.index + match[0].length, tone: term.tone });
    }
  }
  found.sort((left, right) => left.start - right.start || right.end - right.start - (left.end - left.start));
  const segments: Segment[] = [];
  let cursor = 0;
  for (const hit of found) {
    if (hit.start < cursor) continue;
    if (hit.start > cursor) segments.push({ text: text.slice(cursor, hit.start) });
    segments.push({ text: text.slice(hit.start, hit.end), tone: hit.tone });
    cursor = hit.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}
