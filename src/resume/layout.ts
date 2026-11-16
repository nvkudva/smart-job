import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

export interface FontFace {
  family: "sans" | "serif" | "mono";
  isBold: boolean;
  isItalic: boolean;
  /** the PDF's own name for this font (for example "CAAAAA+DMSans-Regular"), so its embedded copy can draw rewritten words */
  pdfName?: string;
}

export interface TextRun {
  text: string;
  x: number;
  width: number;
  fontSize: number;
  face: FontFace;
}

export interface TextLine {
  baseline: number;
  fontSize: number;
  left: number;
  right: number;
  /** bullet glyph drawn left of the text, kept untouched by rewrites */
  hasMarker: boolean;
  runs: TextRun[];
}

/** 0-1 channels, as pdf-lib expects */
interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Consecutive lines that read as one unit: a bullet (with its wrapped lines) or a prose paragraph. */
export interface Block {
  id: string;
  page: number;
  lines: TextLine[];
  text: string;
  left: number;
  /** right edge of the text column, so a rewrite can use the full column width */
  right: number;
  fontSize: number;
  face: FontFace;
  /** words that were bold inside a regular-weight block, so emphasis can be redrawn */
  boldWords: string[];
  /** PDF font name of those bold words */
  boldPdfName?: string;
  color: Rgb;
  boldColor: Rgb;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageLayout {
  page: number;
  blocks: Block[];
  lines: TextLine[];
}

export interface Layout {
  pages: PageLayout[];
}

export interface RawItem {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  face: FontFace;
}

const black: Rgb = { r: 0, g: 0, b: 0 };
const markerPattern = /^[•●▪■◦○·‣⁃∙–-]$/;
const contactPattern = /@|https?:|www\.|\d[\d\s().-]{8,}/;
const dateRangePattern = /\b(19|20)\d{2}\b.*\b((19|20)\d{2}|present|current)\b/i;
const minProseWords = 8;

export function faceFromName(name: string, isSerif: boolean, isMono: boolean): FontFace {
  const lowered = name.toLowerCase();
  const isMonoName = isMono || /courier|mono|consolas|menlo|typewriter/.test(lowered);
  const isSerifName = isSerif || /times|georgia|garamond|cambria|palatino|serif(?!.*sans)|minion|book/.test(lowered);
  return {
    family: isMonoName ? "mono" : isSerifName && !/sans/.test(lowered) ? "serif" : "sans",
    isBold: /bold|black|heavy|semibold|demi/.test(lowered),
    isItalic: /italic|oblique/.test(lowered),
  };
}

function joinRuns(runs: TextRun[]): string {
  let text = "";
  let previousEnd = Number.NEGATIVE_INFINITY;
  for (const run of runs) {
    const hasGap = run.x - previousEnd > run.fontSize * 0.15;
    const isSpaced = /\s$/.test(text) || /^\s/.test(run.text);
    if (text && hasGap && !isSpaced) text += " ";
    text += run.text;
    previousEnd = run.x + run.width;
  }
  return text.replace(/\s+/g, " ").trim();
}

export function lineText(line: TextLine): string {
  return joinRuns(line.runs);
}

function clusterByBaseline(items: RawItem[]): RawItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const clusters: RawItem[][] = [];
  for (const item of sorted) {
    const cluster = clusters.at(-1);
    const isSameLine = cluster && Math.abs(cluster[0]!.y - item.y) <= item.fontSize * 0.35;
    if (isSameLine) cluster.push(item);
    else clusters.push([item]);
  }
  return clusters.map((cluster) => cluster.sort((a, b) => a.x - b.x));
}

function splitAtWideGaps(items: RawItem[]): RawItem[][] {
  const segments: RawItem[][] = [];
  let previous: RawItem | null = null;
  for (const item of items) {
    const isWideGap = previous && item.x - (previous.x + previous.width) > previous.fontSize * 2.5;
    if (!previous || isWideGap) segments.push([]);
    segments.at(-1)!.push(item);
    previous = item;
  }
  return segments;
}

function toRun(item: RawItem): TextRun {
  return { text: item.str, x: item.x, width: item.width, fontSize: item.fontSize, face: item.face };
}

function toLine(segment: RawItem[]): TextLine {
  const hasMarker = segment.length > 1 && markerPattern.test(segment[0]!.str.trim());
  const textItems = hasMarker ? segment.slice(1) : segment;
  const last = textItems.at(-1)!;
  return {
    baseline: segment[0]!.y,
    fontSize: Math.max(...textItems.map((item) => item.fontSize)),
    left: textItems[0]!.x,
    right: last.x + last.width,
    hasMarker,
    runs: textItems.map(toRun),
  };
}

/** Groups pdf.js text items of one page into lines; a line splits where a wide gap separates columns or right-aligned dates. */
export function buildLines(items: RawItem[]): TextLine[] {
  const visible = items.filter((item) => item.str.trim() !== "");
  return clusterByBaseline(visible)
    .flatMap(splitAtWideGaps)
    .map(toLine)
    .sort((a, b) => b.baseline - a.baseline || a.left - b.left);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function isMostlyBold(line: TextLine): boolean {
  const total = line.runs.reduce((sum, run) => sum + run.text.length, 0);
  const bold = line.runs.filter((run) => run.face.isBold).reduce((sum, run) => sum + run.text.length, 0);
  return bold > total * 0.6;
}

// bold or dated single lines are job headings, not prose
function isProse(line: TextLine): boolean {
  const text = lineText(line);
  const isHeading = isMostlyBold(line) || dateRangePattern.test(text);
  return !line.hasMarker && !isHeading && wordCount(text) >= minProseWords && !contactPattern.test(text);
}

function columnRight(line: TextLine, lines: TextLine[]): number {
  const column = lines.filter((other) => Math.abs(other.left - line.left) <= 1.5);
  return Math.max(...column.map((other) => other.right));
}

function isFull(line: TextLine, lines: TextLine[]): boolean {
  return columnRight(line, lines) - line.right <= line.fontSize * 6;
}

function findContinuation(last: TextLine, lines: TextLine[], used: Set<TextLine>): TextLine | null {
  if (!isFull(last, lines)) return null;
  const candidates = lines.filter((line) => {
    const gap = last.baseline - line.baseline;
    const isBelow = gap > last.fontSize * 0.9 && gap < last.fontSize * 2;
    const isAligned = Math.abs(line.left - last.left) <= 1.5 && Math.abs(line.fontSize - last.fontSize) <= 1.2;
    return !used.has(line) && !line.hasMarker && isBelow && isAligned && !contactPattern.test(lineText(line));
  });
  return candidates.sort((a, b) => b.baseline - a.baseline)[0] ?? null;
}

function dominant<T>(weighted: [T, number][], isSame: (a: T, b: T) => boolean): T {
  const totals: [T, number][] = [];
  for (const [value, weight] of weighted) {
    const entry = totals.find(([known]) => isSame(known, value));
    if (entry) entry[1] += weight;
    else totals.push([value, weight]);
  }
  return totals.sort((a, b) => b[1] - a[1])[0]![0];
}

const isSameFace = (a: FontFace, b: FontFace) => a.family === b.family && a.isBold === b.isBold && a.isItalic === b.isItalic;

export function wordKey(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function boldWordsOf(runs: TextRun[], blockFace: FontFace): string[] {
  if (blockFace.isBold) return [];
  const words = runs.filter((run) => run.face.isBold).flatMap((run) => run.text.split(/\s+/));
  return [...new Set(words.map(wordKey).filter(Boolean))];
}

function toBlock(lines: TextLine[], page: number, index: number, allLines: TextLine[]): Block {
  const runs = lines.flatMap((line) => line.runs);
  const face = dominant(runs.map((run): [FontFace, number] => [run.face, run.text.length]), isSameFace);
  const fontSize = dominant(runs.map((run): [number, number] => [run.fontSize, run.text.length]), (a, b) => Math.abs(a - b) < 0.3);
  return {
    id: `b${page}_${index}`,
    page,
    lines,
    text: lines.map(lineText).join(" "),
    left: lines[0]!.left,
    right: Math.max(...lines.map((line) => line.right), columnRight(lines[0]!, allLines)),
    fontSize,
    face,
    boldWords: boldWordsOf(runs, face),
    boldPdfName: runs.find((run) => run.face.isBold && !face.isBold)?.face.pdfName,
    color: black,
    boldColor: black,
  };
}

/** Bullets and prose paragraphs that a rewrite may replace; headings, titles, dates and contact lines are left out. */
export function buildBlocks(lines: TextLine[], page: number): Block[] {
  const used = new Set<TextLine>();
  const blocks: Block[] = [];
  for (const line of lines) {
    const isStart = !used.has(line) && (line.hasMarker || isProse(line));
    if (!isStart) continue;
    const members = [line];
    used.add(line);
    for (let next = findContinuation(line, lines, used); next; next = findContinuation(next, lines, used)) {
      members.push(next);
      used.add(next);
    }
    blocks.push(toBlock(members, page, blocks.length + 1, lines));
  }
  return blocks;
}

// ---------- pdf.js I/O ----------

interface PdfFont {
  name?: string;
  isSerifFont?: boolean;
  isMonospace?: boolean;
}

const fontWaitMs = 4000;

function fontObject(page: PDFPageProxy, fontName: string): Promise<PdfFont | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), fontWaitMs);
    page.commonObjs.get(fontName, (font: PdfFont) => {
      clearTimeout(timer);
      resolve(font);
    });
  });
}

async function resolveFaces(page: PDFPageProxy, fontNames: string[]): Promise<Map<string, FontFace>> {
  const faces = new Map<string, FontFace>();
  for (const fontName of fontNames) {
    const font = await fontObject(page, fontName);
    faces.set(fontName, { ...faceFromName(font?.name ?? "", font?.isSerifFont ?? false, font?.isMonospace ?? false), pdfName: font?.name });
  }
  return faces;
}

function overlapsRect(line: TextLine, rect: number[]): boolean {
  const [left, bottom, right, top] = rect as [number, number, number, number];
  const isHorizontal = line.left < right && line.right > left;
  const isVertical = line.baseline - line.fontSize * 0.25 < top && line.baseline + line.fontSize > bottom;
  return isHorizontal && isVertical;
}

/** A rewrite would leave a link annotation hovering over text it no longer describes, so linked blocks stay as they are. */
export function withoutLinked(blocks: Block[], linkRects: number[][]): Block[] {
  return blocks.filter((block) => !block.lines.some((line) => linkRects.some((rect) => overlapsRect(line, rect))));
}

async function linkRects(page: PDFPageProxy): Promise<number[][]> {
  const annotations = await page.getAnnotations();
  return annotations.filter((annotation) => annotation.subtype === "Link" && Array.isArray(annotation.rect)).map((annotation) => annotation.rect as number[]);
}

async function readPage(page: PDFPageProxy): Promise<PageLayout> {
  const number = page.pageNumber;
  if (page.rotate !== 0) return { page: number, blocks: [], lines: [] };
  // loading the operator list is what makes pdf.js resolve the real font names
  await page.getOperatorList();
  const content = await page.getTextContent();
  const textItems = content.items.filter((item) => "str" in item);
  const faces = await resolveFaces(page, [...new Set(textItems.map((item) => item.fontName))]);
  const items = textItems.map((item): RawItem => ({
    str: item.str,
    x: item.transform[4]!,
    y: item.transform[5]!,
    width: item.width,
    fontSize: Math.hypot(item.transform[0]!, item.transform[1]!),
    face: faces.get(item.fontName)!,
  }));
  const lines = buildLines(items);
  return { page: number, lines, blocks: withoutLinked(buildBlocks(lines, number), await linkRects(page)) };
}

/** The document must be opened with `fontExtraProperties: true` or every font reads as plain sans. */
export async function read(document: PDFDocumentProxy): Promise<Layout> {
  const pages: PageLayout[] = [];
  for (let number = 1; number <= document.numPages; number++) pages.push(await readPage(await document.getPage(number)));
  return { pages };
}

export function allBlocks(layout: Layout): Block[] {
  return layout.pages.flatMap((page) => page.blocks);
}

// ---------- text colour ----------

const inkLuminanceLimit = 200;
const inkSampleShare = 0.2;
const minInkPixels = 8;

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Average of the darkest pixels (full-coverage ink, not anti-aliased edges) over RGBA buffers; null when there is no ink. */
export function inkColor(buffers: Uint8ClampedArray[]): Rgb | null {
  const ink: { r: number; g: number; b: number; light: number }[] = [];
  for (const pixels of buffers) {
    for (let index = 0; index + 3 < pixels.length; index += 4) {
      const [r, g, b] = [pixels[index]!, pixels[index + 1]!, pixels[index + 2]!];
      const light = luminance(r, g, b);
      if (light < inkLuminanceLimit && pixels[index + 3]! > 200) ink.push({ r, g, b, light });
    }
  }
  if (ink.length < minInkPixels) return null;
  const darkest = ink.sort((a, b) => a.light - b.light).slice(0, Math.max(minInkPixels, Math.floor(ink.length * inkSampleShare)));
  const mean = (channel: "r" | "g" | "b") => darkest.reduce((sum, pixel) => sum + pixel[channel], 0) / darkest.length / 255;
  return { r: mean("r"), g: mean("g"), b: mean("b") };
}

const colorScale = 3;

interface PageView {
  viewBox: number[];
  scale: number;
}

function sampleRuns(context: CanvasRenderingContext2D, view: PageView, block: Block, runs: [TextLine, TextRun][]): Rgb | null {
  const [originX, , , top] = view.viewBox as [number, number, number, number];
  const buffers: Uint8ClampedArray[] = [];
  for (const [line, run] of runs) {
    const left = Math.floor((run.x - originX) * view.scale);
    const upper = Math.floor((top - (line.baseline + block.fontSize * 0.8)) * view.scale);
    const width = Math.ceil(run.width * view.scale);
    const height = Math.ceil(block.fontSize * view.scale);
    if (width > 0 && height > 0) buffers.push(context.getImageData(left, upper, width, height).data);
  }
  return inkColor(buffers);
}

function colorize(context: CanvasRenderingContext2D, viewport: PageView, block: Block): void {
  const all = block.lines.flatMap((line): [TextLine, TextRun][] => line.runs.map((run) => [line, run]));
  const emphasized = all.filter(([, run]) => run.face.isBold !== block.face.isBold);
  const plain = all.filter(([, run]) => run.face.isBold === block.face.isBold);
  block.color = sampleRuns(context, viewport, block, plain) ?? black;
  block.boldColor = sampleRuns(context, viewport, block, emphasized) ?? block.color;
}

/** Renders each page once and copies the real ink colours into the blocks, so redrawn text matches grey or tinted body text. Best effort: blocks keep black on any failure. */
export async function sampleColors(document: PDFDocumentProxy, resume: Layout): Promise<void> {
  for (const page of resume.pages) {
    if (page.blocks.length === 0) continue;
    try {
      const pdfPage = await document.getPage(page.page);
      const viewport = pdfPage.getViewport({ scale: colorScale });
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      await pdfPage.render({ canvasContext: context, canvas, viewport }).promise;
      for (const block of page.blocks) colorize(context, viewport, block);
    } catch {
      continue;
    }
  }
}
