import { decodePDFRawStream, PDFArray, PDFDict, type PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from "pdf-lib";

/**
 * A font the resume PDF already carries (a subset holding the glyphs the document uses), so rewritten words can be drawn in the resume's own typeface.
 * Only Type0 / Identity-H fonts with a ToUnicode map are read, which is what Google Docs, Word and Skia exports write; anything else keeps the stand-in font.
 */
export interface EmbeddedFont {
  ref: PDFRef;
  /** every character of `text` has a glyph in this subset */
  hasText(text: string): boolean;
  /** width of `text` at `size` points */
  width(text: string, size: number): number;
  /** the two-byte glyph codes of `text` as hex digits, for a PDF string */
  hex(text: string): string;
}

const unitsPerEm = 1000;

/** Character to glyph code, from the font's ToUnicode CMap. Entries that map to more than one character (ligatures) are skipped. */
export function parseToUnicode(cmap: string): Map<string, number> {
  const codes = new Map<string, number>();
  const add = (code: number, unicode: string) => {
    if (unicode.length === 4 && !codes.has(String.fromCharCode(parseInt(unicode, 16)))) codes.set(String.fromCharCode(parseInt(unicode, 16)), code);
  };
  for (const [, section] of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, code, unicode] of section!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) add(parseInt(code!, 16), unicode!);
  }
  for (const [, section] of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, low, high, unicode] of section!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]{4})>/g)) {
      for (let code = parseInt(low!, 16); code <= parseInt(high!, 16); code++) add(code, (parseInt(unicode!, 16) + code - parseInt(low!, 16)).toString(16).padStart(4, "0"));
    }
  }
  return codes;
}

/** Glyph code to width, from a CIDFont /W array: `c [w1 w2 ...]` and `c1 c2 w`. */
export function parseWidths(array: PDFArray | undefined): Map<number, number> {
  const widths = new Map<number, number>();
  if (!array) return widths;
  for (let index = 0; index < array.size(); index++) {
    const first = array.lookup(index);
    const next = array.lookup(index + 1);
    if (!(first instanceof PDFNumber)) continue;
    if (next instanceof PDFArray) {
      for (let offset = 0; offset < next.size(); offset++) widths.set(first.asNumber() + offset, (next.lookup(offset) as PDFNumber).asNumber());
      index += 1;
    } else if (next instanceof PDFNumber) {
      const width = (array.lookup(index + 2) as PDFNumber).asNumber();
      for (let code = first.asNumber(); code <= next.asNumber(); code++) widths.set(code, width);
      index += 2;
    }
  }
  return widths;
}

function embeddedFont(ref: PDFRef, codes: Map<string, number>, widths: Map<number, number>, defaultWidth: number): EmbeddedFont {
  const chars = (text: string) => [...text.normalize("NFC")];
  return {
    ref,
    hasText: (text) => chars(text).every((char) => codes.has(char)),
    width: (text, size) => (chars(text).reduce((sum, char) => sum + (widths.get(codes.get(char)!) ?? defaultWidth), 0) / unitsPerEm) * size,
    hex: (text) => chars(text).map((char) => codes.get(char)!.toString(16).padStart(4, "0")).join("").toUpperCase(),
  };
}

function readFont(document: PDFDocument, ref: PDFRef): [name: string, font: EmbeddedFont] | null {
  const dict = document.context.lookup(ref);
  if (!(dict instanceof PDFDict) || dict.get(PDFName.of("Subtype")) !== PDFName.of("Type0") || dict.get(PDFName.of("Encoding")) !== PDFName.of("Identity-H")) return null;
  const toUnicode = dict.lookup(PDFName.of("ToUnicode"));
  const descendants = dict.lookup(PDFName.of("DescendantFonts"));
  const cid = descendants instanceof PDFArray ? descendants.lookup(0) : undefined;
  const baseFont = dict.get(PDFName.of("BaseFont"));
  if (!(toUnicode instanceof PDFRawStream) || !(cid instanceof PDFDict) || !(baseFont instanceof PDFName)) return null;
  const map = cid.lookup(PDFName.of("CIDToGIDMap"));
  if (map instanceof PDFRawStream) return null;
  const codes = parseToUnicode(new TextDecoder().decode(decodePDFRawStream(toUnicode).decode()));
  const width = cid.lookup(PDFName.of("DW"));
  const widths = parseWidths(cid.lookup(PDFName.of("W")) as PDFArray | undefined);
  return [baseFont.decodeText(), embeddedFont(ref, codes, widths, width instanceof PDFNumber ? width.asNumber() : unitsPerEm)];
}

/** Every usable font in the document's page resources, by PostScript name as pdf.js reports it (for example "CAAAAA+DMSans-Regular"). */
export function readAll(document: PDFDocument): Map<string, EmbeddedFont> {
  const fonts = new Map<string, EmbeddedFont>();
  for (const page of document.getPages()) {
    const resources = page.node.Resources()?.lookup(PDFName.of("Font"));
    if (!(resources instanceof PDFDict)) continue;
    for (const [, ref] of resources.entries()) {
      if (!(ref instanceof PDFRef)) continue;
      const found = readFont(document, ref);
      if (found && !fonts.has(found[0])) fonts.set(found[0], found[1]);
    }
  }
  return fonts;
}
