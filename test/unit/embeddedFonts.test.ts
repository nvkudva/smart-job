import { expect, test } from "bun:test";
import { PDFArray, PDFContext } from "pdf-lib";
import * as embeddedFonts from "../../src/resume/embeddedFonts.ts";

const cmap = `begincmap
2 beginbfchar
<0001> <0041>
<0003> <0020>
endbfchar
1 beginbfrange
<0010> <0012> <0061>
endbfrange
1 beginbfchar
<0020> <00660069>
endbfchar
endcmap`;

test("ToUnicode maps single characters from bfchar and bfrange, and skips ligatures", () => {
  const codes = embeddedFonts.parseToUnicode(cmap);
  expect(codes.get("A")).toBe(1);
  expect(codes.get(" ")).toBe(3);
  expect([codes.get("a"), codes.get("b"), codes.get("c")]).toEqual([0x10, 0x11, 0x12]);
  expect(codes.size).toBe(5);
});

test("W arrays give widths for a list of codes and for a code range", () => {
  const array = PDFContext.create().obj([0, [538, 709], 13, 20, 600]) as PDFArray;
  const widths = embeddedFonts.parseWidths(array);
  expect([widths.get(0), widths.get(1), widths.get(13), widths.get(17), widths.get(21)]).toEqual([538, 709, 600, 600, undefined]);
});
