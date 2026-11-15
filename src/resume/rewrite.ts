import * as normalize from "../ai/normalize.ts";
import * as layout from "./layout.ts";

export interface Measurer {
  /** width of `text` drawn in `face` at `size` points */
  width(text: string, face: layout.FontFace, size: number): number;
  canEncode(char: string): boolean;
}

export interface Rewrite {
  id: string;
  newText: string;
  reason: string;
}

export interface Placement {
  block: layout.Block;
  /** new text wrapped to the block's width; never more lines than the original */
  lines: string[];
  /** font size multiplier that compensates for the stand-in font being wider than the original */
  scale: number;
  reason: string;
}

export interface Overlong {
  rewrite: Rewrite;
  block: layout.Block;
  maxChars: number;
}

const minScale = 0.85;
const lineTolerance = 0.5;

// ---------- prompt side ----------

function capacity(block: layout.Block): { lineCount: number; maxChars: number } {
  const lineCount = block.lines.length;
  const drawnWidth = block.lines.reduce((sum, line) => sum + line.right - line.left, 0);
  const charCount = block.lines.reduce((sum, line) => sum + layout.lineText(line).length, 0);
  const averageCharWidth = drawnWidth / Math.max(1, charCount);
  const maxChars = Math.floor(((lineCount * (block.right - block.left)) / averageCharWidth) * 0.95);
  return { lineCount, maxChars };
}

function describePage(page: layout.PageLayout): string {
  const blockOfFirstLine = new Map(page.blocks.map((block) => [block.lines[0]!, block]));
  const blockLines = new Set(page.blocks.flatMap((block) => block.lines));
  const rows: string[] = [];
  for (const line of page.lines) {
    const block = blockOfFirstLine.get(line);
    if (block) {
      const { lineCount, maxChars } = capacity(block);
      rows.push(`[${block.id} | ${lineCount} line${lineCount > 1 ? "s" : ""} | max ${maxChars} chars] ${block.text}`);
    } else if (!blockLines.has(line)) rows.push(layout.lineText(line));
  }
  return rows.join("\n");
}

/** The resume as plain text, with editable blocks tagged by id and their character budget. */
export function describe(resume: layout.Layout): string {
  return resume.pages.map(describePage).join("\n\n");
}

// ---------- model output ----------

export function parse(raw: unknown): Rewrite[] {
  const data = normalize.asRecord(raw);
  const items = Array.isArray(data.rewrites) ? data.rewrites : [];
  const rewrites = items.map(normalize.asRecord).map((item) => ({
    id: normalize.asString(item.id),
    newText: normalize.asString(item.newText ?? item.text ?? item.after),
    reason: normalize.asString(item.reason),
  }));
  return rewrites.filter((rewrite) => rewrite.id && rewrite.newText);
}

const symbolFallbacks: [RegExp, string][] = [
  [/→|⇒|➔/g, "->"],
  [/≥/g, ">="],
  [/≤/g, "<="],
  [/[−‐‑‒]/g, "-"],
  [/[   ​]/g, " "],
  [/\*\*|__/g, ""],
  [/^[\s•●▪■◦○·‣⁃∙*-]+/, ""],
];

/** Standard PDF fonts only cover WinAnsi: map the common symbols, drop the rest. */
export function clean(text: string, measurer: Measurer): string {
  let result = text;
  for (const [pattern, replacement] of symbolFallbacks) result = result.replace(pattern, replacement);
  const encodable = [...result].filter((char) => measurer.canEncode(char));
  return encodable.join("").replace(/\s+/g, " ").trim();
}

// a rewrite that shares almost no content words with its block is the model pointing at the wrong id
function keepsContent(newText: string, original: string): boolean {
  const contentWords = (text: string) => new Set(normalize.comparable(text).split(" ").filter((word) => word.length > 3));
  const originalWords = contentWords(original);
  const newWords = contentWords(newText);
  if (originalWords.size === 0) return true;
  const kept = [...originalWords].filter((word) => newWords.has(word)).length;
  return kept / originalWords.size >= 0.3;
}

function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,.]*\d|\d/g) ?? []).map((value) => value.replace(/[,.]+$/, ""));
}

function hasInventedNumbers(newText: string, original: string): boolean {
  const known = new Set(numbersIn(original));
  return numbersIn(newText).some((value) => !known.has(value));
}

// ---------- fitting ----------

export function faceFor(block: layout.Block, word: string): layout.FontFace {
  const isEmphasized = block.boldWords.includes(layout.wordKey(word));
  return isEmphasized ? { ...block.face, isBold: true } : block.face;
}

function fontScale(block: layout.Block, measurer: Measurer): number {
  const originalWidth = block.lines.reduce((sum, line) => sum + line.right - line.left, 0);
  const standInWidth = block.lines.reduce((sum, line) => sum + measurer.width(layout.lineText(line), block.face, block.fontSize), 0);
  return normalize.clamp(originalWidth / Math.max(1, standInWidth), minScale, 1);
}

export function wrap(words: string[], maxWidth: number, widthOf: (text: string) => number): string[] | null {
  const spaceWidth = widthOf(" ");
  const lines: string[] = [];
  let current = "";
  let currentWidth = 0;
  for (const word of words) {
    const wordWidth = widthOf(word);
    if (wordWidth > maxWidth) return null;
    const nextWidth = current ? currentWidth + spaceWidth + wordWidth : wordWidth;
    if (current && nextWidth > maxWidth) {
      lines.push(current);
      current = word;
      currentWidth = wordWidth;
    } else {
      current = current ? `${current} ${word}` : word;
      currentWidth = nextWidth;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function fitLines(text: string, block: layout.Block, scale: number, measurer: Measurer): string[] | null {
  const size = block.fontSize * scale;
  const widthOf = (piece: string) => measurer.width(piece, faceFor(block, piece), size);
  const lines = wrap(text.split(" "), block.right - block.left + lineTolerance, widthOf);
  return lines && lines.length <= block.lines.length ? lines : null;
}

type Outcome = { kind: "placed"; placement: Placement } | { kind: "overlong" } | { kind: "rejected" };

function place(rewrite: Rewrite, block: layout.Block, measurer: Measurer): Outcome {
  const text = clean(rewrite.newText, measurer);
  const isUnchanged = normalize.comparable(text) === normalize.comparable(block.text);
  if (!text || isUnchanged || hasInventedNumbers(text, block.text) || !keepsContent(text, block.text)) return { kind: "rejected" };
  const scale = fontScale(block, measurer);
  const lines = fitLines(text, block, scale, measurer);
  if (!lines) return { kind: "overlong" };
  return { kind: "placed", placement: { block, lines, scale, reason: rewrite.reason } };
}

/** Characters a block can hold, the same budget the model is given. */
export const maxCharsOf = (block: layout.Block): number => capacity(block).maxChars;

/** The user's own text for a block: cleaned and fitted only. No truthfulness checks, the user is the author. */
export function fit(text: string, block: layout.Block, measurer: Measurer, reason = "Edited by you"): { placement: Placement; cleaned: string } | { cleaned: string; overBy: number } {
  const cleaned = clean(text, measurer);
  const scale = fontScale(block, measurer);
  const lines = cleaned ? fitLines(cleaned, block, scale, measurer) : null;
  if (!lines) return { cleaned, overBy: Math.max(1, cleaned.length - maxCharsOf(block)) };
  return { placement: { block, lines, scale, reason }, cleaned };
}

/** Placements that fit their original lines, plus the rewrites that were valid but too long to fit. */
export function validate(rewrites: Rewrite[], resume: layout.Layout, measurer: Measurer): { placements: Placement[]; overlong: Overlong[] } {
  const blocks = new Map(layout.allBlocks(resume).map((block) => [block.id, block]));
  const seen = new Set<string>();
  const placements: Placement[] = [];
  const overlong: Overlong[] = [];
  for (const rewrite of rewrites) {
    const block = blocks.get(rewrite.id);
    if (!block || seen.has(rewrite.id)) continue;
    seen.add(rewrite.id);
    const outcome = place(rewrite, block, measurer);
    if (outcome.kind === "placed") placements.push(outcome.placement);
    if (outcome.kind === "overlong") overlong.push({ rewrite, block, maxChars: capacity(block).maxChars });
  }
  return { placements, overlong };
}

export function highlights(block: layout.Block): layout.Rect[] {
  return block.lines.map((line) => ({
    x: line.left,
    y: line.baseline - block.fontSize * 0.22,
    width: line.right - line.left,
    height: block.fontSize * 1.05,
  }));
}
