import { decodePDFRawStream, type PDFContext, PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFPage } from "pdf-lib";
import * as strip from "./strip.ts";

const defaultTwoByteWidth = 1000;

function numberAt(context: PDFContext, array: PDFArray, index: number): number | undefined {
  const value = context.lookup(array.get(index));
  return value instanceof PDFNumber ? value.asNumber() : undefined;
}

/** CID `W` array: either `first [w1 w2 ...]` or `first last w`. */
function cidWidths(context: PDFContext, widthArray: PDFArray | undefined): Map<number, number> {
  const widths = new Map<number, number>();
  if (!widthArray) return widths;
  let index = 0;
  while (index < widthArray.size()) {
    const first = numberAt(context, widthArray, index);
    const following = context.lookup(widthArray.get(index + 1));
    if (first === undefined) break;
    if (following instanceof PDFArray) {
      for (let offset = 0; offset < following.size(); offset++) widths.set(first + offset, numberAt(context, following, offset) ?? 0);
      index += 2;
      continue;
    }
    const last = numberAt(context, widthArray, index + 1) ?? first;
    const width = numberAt(context, widthArray, index + 2) ?? 0;
    for (let cid = first; cid <= last && cid - first < 70000; cid++) widths.set(cid, width);
    index += 3;
  }
  return widths;
}

function compositeMetrics(context: PDFContext, font: PDFDict): strip.FontMetrics {
  const descendants = context.lookupMaybe(font.get(PDFName.of("DescendantFonts")), PDFArray);
  const descendant = descendants && context.lookupMaybe(descendants.get(0), PDFDict);
  const defaultWidth = descendant ? (context.lookupMaybe(descendant.get(PDFName.of("DW")), PDFNumber)?.asNumber() ?? defaultTwoByteWidth) : defaultTwoByteWidth;
  const widths = cidWidths(context, descendant && context.lookupMaybe(descendant.get(PDFName.of("W")), PDFArray));
  return { isTwoByte: true, widthOf: (code) => widths.get(code) ?? defaultWidth };
}

function simpleMetrics(context: PDFContext, font: PDFDict): strip.FontMetrics {
  const firstChar = context.lookupMaybe(font.get(PDFName.of("FirstChar")), PDFNumber)?.asNumber() ?? 0;
  const widths = context.lookupMaybe(font.get(PDFName.of("Widths")), PDFArray);
  const descriptor = context.lookupMaybe(font.get(PDFName.of("FontDescriptor")), PDFDict);
  const missing = descriptor && context.lookupMaybe(descriptor.get(PDFName.of("MissingWidth")), PDFNumber)?.asNumber();
  return { isTwoByte: false, widthOf: (code) => (widths && numberAt(context, widths, code - firstChar)) ?? missing ?? 500 };
}

function metricsOf(context: PDFContext, font: PDFDict): strip.FontMetrics {
  const subtype = context.lookupMaybe(font.get(PDFName.of("Subtype")), PDFName);
  return subtype?.toString() === "/Type0" ? compositeMetrics(context, font) : simpleMetrics(context, font);
}

function fontLookup(page: PDFPage): strip.FontLookup {
  const context = page.doc.context;
  const resources = page.node.Resources();
  const fonts = resources && context.lookupMaybe(resources.get(PDFName.of("Font")), PDFDict);
  const cache = new Map<string, strip.FontMetrics | undefined>();
  return (name) => {
    if (cache.has(name)) return cache.get(name);
    const font = fonts && context.lookupMaybe(fonts.get(PDFName.of(name)), PDFDict);
    const metrics = font ? metricsOf(context, font) : undefined;
    cache.set(name, metrics);
    return metrics;
  };
}

function binaryString(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += 8192) text += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return text;
}

function binaryBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index);
  return bytes;
}

function contentRefs(page: PDFPage): PDFRef[] {
  const contents = page.node.get(PDFName.of("Contents"));
  if (contents instanceof PDFRef) return [contents];
  return contents instanceof PDFArray ? contents.asArray().filter((entry): entry is PDFRef => entry instanceof PDFRef) : [];
}

function contentStreams(page: PDFPage): PDFRawStream[] {
  const context = page.doc.context;
  const contents = page.node.Contents();
  if (contents instanceof PDFRawStream) return [contents];
  if (!(contents instanceof PDFArray)) return [];
  const streams = contents.asArray().map((entry) => context.lookup(entry));
  return streams.filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream);
}

export type Removal = Pick<strip.StripResult, "hits" | "inserted">;

/** Deletes the original text-showing operators of the given line boxes and writes their new text in the same place; returns which boxes lost text and which got theirs. */
export function removeText(page: PDFPage, boxes: strip.LineBox[]): Removal {
  const streams = contentStreams(page);
  if (streams.length === 0 || boxes.length === 0) return { hits: boxes.map(() => false), inserted: boxes.map(() => false) };
  const source = streams.map((stream) => binaryString(decodePDFRawStream(stream).decode())).join("\n");
  const result = strip.strip(source, fontLookup(page), boxes);
  if (!result.hits.includes(true)) return result;
  const context = page.doc.context;
  const replaced = contentRefs(page);
  page.node.set(PDFName.of("Contents"), context.register(context.flateStream(binaryBytes(result.content))));
  for (const ref of replaced) context.delete(ref);
  return result;
}
