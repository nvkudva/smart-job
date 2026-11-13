import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import type * as layout from "./layout.ts";
import type { FontFace } from "./layout.ts";
import * as pageText from "./pageText.ts";
import * as rewrite from "./rewrite.ts";
import type * as strip from "./strip.ts";

const standardFonts: Record<FontFace["family"], [regular: StandardFonts, bold: StandardFonts, italic: StandardFonts, boldItalic: StandardFonts]> = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

function standardFontFor(face: FontFace): StandardFonts {
  const [regular, bold, italic, boldItalic] = standardFonts[face.family];
  if (face.isBold && face.isItalic) return boldItalic;
  if (face.isBold) return bold;
  return face.isItalic ? italic : regular;
}

class FontSet {
  private fonts = new Map<StandardFonts, PDFFont>();
  constructor(private document: PDFDocument) {}

  async preload(): Promise<void> {
    for (const family of Object.values(standardFonts)) {
      for (const name of family) this.fonts.set(name, await this.document.embedFont(name));
    }
  }

  pick(face: FontFace): PDFFont {
    return this.fonts.get(standardFontFor(face))!;
  }
}

export async function createMeasurer(): Promise<rewrite.Measurer> {
  const fonts = new FontSet(await PDFDocument.create());
  await fonts.preload();
  const characters = new Set(fonts.pick({ family: "sans", isBold: false, isItalic: false }).getCharacterSet());
  return {
    width: (text, face, size) => fonts.pick(face).widthOfTextAtSize(text, size),
    canEncode: (char) => characters.has(char.codePointAt(0)!),
  };
}

const white = rgb(1, 1, 1);

function coverLine(page: PDFPage, block: layout.Block, line: layout.TextLine): void {
  const right = Math.max(block.right, line.right);
  page.drawRectangle({ x: block.left - 0.5, y: line.baseline - block.fontSize * 0.24, width: right - block.left + 1.5, height: block.fontSize * 1.05, color: white });
}

interface WordDraw {
  text: string;
  x: number;
  y: number;
  size: number;
  font: PDFFont;
  color: [red: number, green: number, blue: number];
}

function layoutWords(text: string, origin: { x: number; y: number }, placement: rewrite.Placement, fonts: FontSet): WordDraw[] {
  const { block } = placement;
  const size = block.fontSize * placement.scale;
  const spaceWidth = fonts.pick(block.face).widthOfTextAtSize(" ", size);
  const words: WordDraw[] = [];
  let x = origin.x;
  for (const word of text.split(" ")) {
    const face = rewrite.faceFor(block, word);
    const font = fonts.pick(face);
    const { r, g, b } = face.isBold === block.face.isBold ? block.color : block.boldColor;
    words.push({ text: word, x, y: origin.y, size, font, color: [r, g, b] });
    x += font.widthOfTextAtSize(word, size) + spaceWidth;
  }
  return words;
}

function drawWords(page: PDFPage, words: WordDraw[]): void {
  for (const { text, x, y, size, font, color } of words) page.drawText(text, { x, y, size, font, color: rgb(...color) });
}

interface LineEntry {
  block: layout.Block;
  line: layout.TextLine;
  words: WordDraw[];
}

function lineEntries(placements: rewrite.Placement[], fonts: FontSet): LineEntry[] {
  return placements.flatMap((placement) =>
    placement.block.lines.map((line, index) => {
      const text = placement.lines[index];
      const words = text === undefined ? [] : layoutWords(text, { x: placement.block.left, y: line.baseline }, placement, fonts);
      return { block: placement.block, line, words };
    }),
  );
}

/** Registers each font in the page resources on first use and returns its name for the content stream. */
function fontKeys(page: PDFPage): (font: PDFFont) => string {
  const keys = new Map<PDFFont, string>();
  return (font) => {
    if (!keys.has(font)) keys.set(font, page.node.newFontDictionary(font.name, font.ref).toString());
    return keys.get(font)!;
  };
}

function toBox({ line, words }: LineEntry, keyOf: (font: PDFFont) => string): strip.LineBox {
  const draws = words.map((word) => ({
    fontKey: keyOf(word.font),
    size: word.size,
    color: word.color,
    x: word.x,
    y: word.y,
    hex: word.font.encodeText(word.text).toString(),
  }));
  return { left: line.left, right: line.right, baseline: line.baseline, fontSize: line.fontSize, draws };
}

/** Removes the original text and writes the new text in its place in the stream; a line that could not be edited there is covered and drawn on top instead. */
function rewritePage(page: PDFPage, placements: rewrite.Placement[], fonts: FontSet): void {
  const entries = lineEntries(placements, fonts);
  const keyOf = fontKeys(page);
  const { hits, inserted } = pageText.removeText(page, entries.map((entry) => toBox(entry, keyOf)));
  entries.forEach((entry, index) => {
    if (!hits[index]) coverLine(page, entry.block, entry.line);
    if (!inserted[index]) drawWords(page, entry.words);
  });
}

/** Rewrites each changed line in the content stream, keeping its reading-order position; everything else in the file is untouched. */
export async function apply(original: Uint8Array, placements: rewrite.Placement[]): Promise<Uint8Array> {
  const document = await PDFDocument.load(original, { ignoreEncryption: true });
  const fonts = new FontSet(document);
  await fonts.preload();
  const pageNumbers = new Set(placements.map((placement) => placement.block.page));
  for (const pageNumber of pageNumbers) {
    rewritePage(document.getPage(pageNumber - 1), placements.filter((placement) => placement.block.page === pageNumber), fonts);
  }
  return document.save();
}
