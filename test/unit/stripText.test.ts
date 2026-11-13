import { describe, expect, test } from "bun:test";
import { decodePDFRawStream, PDFDocument, PDFRawStream, StandardFonts } from "pdf-lib";
import * as layout from "../../src/resume/layout.ts";
import * as render from "../../src/resume/render.ts";
import * as tokens from "../../src/resume/contentTokens.ts";
import * as strip from "../../src/resume/strip.ts";

const fonts: strip.FontLookup = () => ({ isTwoByte: false, widthOf: () => 500 });
const box: strip.LineBox = { left: 50, right: 300, baseline: 700, fontSize: 10 };

describe("boxAt", () => {
  const boxes = [box, { ...box, baseline: 686 }];
  test("finds the line by baseline and horizontal extent", () => {
    expect(strip.boxAt(boxes, 100, 700.5)).toBe(0);
    expect(strip.boxAt(boxes, 100, 686)).toBe(1);
  });
  test("ignores glyphs left of the text, right of it, or between lines", () => {
    expect(strip.boxAt(boxes, 40, 700)).toBe(-1);
    expect(strip.boxAt(boxes, 320, 700)).toBe(-1);
    expect(strip.boxAt(boxes, 100, 693)).toBe(-1);
  });
});

describe("strip", () => {
  test("removes show operators inside the box and keeps the rest byte for byte", () => {
    const source = "q 0 0 1 rg BT /F1 10 Tf 40 700 Td (-) Tj 12 0 Td (old words) Tj ET BT /F1 10 Tf 50 650 Td (kept) Tj ET Q";
    const result = strip.strip(source, fonts, [box]);
    expect(result.hits).toEqual([true]);
    expect(result.content).not.toContain("old words");
    expect(result.content).toContain("(-) Tj");
    expect(result.content).toContain("(kept) Tj");
    expect(result.content.startsWith("q 0 0 1 rg BT /F1 10 Tf 40 700 Td (-) Tj")).toBe(true);
  });

  test("reports boxes with no text so the caller can cover them", () => {
    const result = strip.strip("BT /F1 10 Tf 50 500 Td (elsewhere) Tj ET", fonts, [box]);
    expect(result.hits).toEqual([false]);
    expect(result.content).toContain("(elsewhere) Tj");
  });

  test("follows cm flips like the Skia/Google Docs streams", () => {
    const source = "1 0 0 -1 0 842 cm .75 0 0 .75 0 0 cm BT /F1 12 Tf 1 0 0 -1 66.6667 0 Tm 0 -150.6667 Td (gone) Tj ET";
    const line = { left: 50, right: 70, baseline: 729, fontSize: 9 };
    expect(strip.strip(source, fonts, [line]).hits).toEqual([true]);
    expect(strip.strip(source, fonts, [{ ...line, baseline: 500 }]).hits).toEqual([false]);
  });

  test("a removed run keeps the text position for operators that follow without a move", () => {
    const source = "BT /F1 10 Tf 50 700 Td [(ab) -100 (cd)] TJ (z) Tj ET";
    const result = strip.strip(source, fonts, [{ ...box, right: 60 }]);
    expect(result.content).toBe("BT /F1 10 Tf 50 700 Td [-2100] TJ (z) Tj ET");
    expect(result.content).not.toContain("(ab)");
  });

  test("two-byte fonts read codes in pairs and ' moves to the next line", () => {
    const wide: strip.FontLookup = () => ({ isTwoByte: true, widthOf: (code) => code });
    const source = "BT /F1 10 Tf 12 TL 50 700 Td <03E8> Tj <0001> ' ET";
    const result = strip.strip(source, wide, [{ ...box, baseline: 688 }]);
    expect(result.hits).toEqual([true]);
    expect(result.content).toContain("<03E8> Tj");
    expect(result.content).toContain("T*");
    expect(result.content).not.toContain("<0001>");
  });

  test("skips inline images and dictionaries", () => {
    const source = "/Span <</MCID 1 >>BDC q 10 0 0 10 0 0 cm BI /W 1 /H 1 ID (EI) \nEI Q BT /F1 10 Tf 50 700 Td (old) Tj ET EMC";
    const result = strip.strip(source, fonts, [box]);
    expect(result.hits).toEqual([true]);
    expect(result.content).toContain("EMC");
    expect(result.content).not.toContain("(old)");
  });
});

describe("strip insertion", () => {
  const draws = [{ fontKey: "/SJ", size: 10, color: [0, 0, 0] as [number, number, number], x: 50, y: 700, hex: "<4E4557>" }];
  const withDraws = { ...box, draws };

  test("writes the new text at the first removed operator, before the lines that follow", () => {
    const source = "BT /F1 10 Tf 50 700 Td (old) Tj ET BT /F1 10 Tf 50 650 Td (next) Tj ET";
    const result = strip.strip(source, fonts, [withDraws]);
    expect(result.inserted).toEqual([true]);
    expect(result.content).toContain("q 1 0 0 1 0 0 cm 0 Tc 0 Tw 100 Tz 0 Tr 0 Ts BT /SJ 10 Tf 0 0 0 rg 1 0 0 1 50 700 Tm <4E4557> Tj ET Q");
    expect(result.content.indexOf("<4E4557>")).toBeLessThan(result.content.indexOf("(next)"));
    expect(result.content).not.toContain("(old)");
  });

  test("inserts once per line even when the line has several text operators", () => {
    const result = strip.strip("BT /F1 10 Tf 50 700 Td (ab) Tj (cd) Tj ET", fonts, [withDraws]);
    expect(result.content.match(/<4E4557>/g)).toHaveLength(1);
  });

  test("inside a text object it closes it and reopens it at the same text position", () => {
    const source = "BT /F1 10 Tf 40 700 Td (-) Tj 12 0 Td (old) Tj (z) Tj ET";
    const result = strip.strip(source, fonts, [{ ...withDraws, left: 52 }]);
    expect(result.content).toContain("12 0 Td  ET q");
    expect(result.content).toContain("Q BT 1 0 0 1 52 700 Tm [-1500] TJ");
  });

  test("when the text matrix is past the line start, the reopened text object is moved back to it", () => {
    const source = "BT /F1 10 Tf 40 700 Td (ab) Tj (old) Tj ET";
    const result = strip.strip(source, fonts, [{ ...withDraws, left: 45 }]);
    expect(result.content).toContain("Q BT 1 0 0 1 40 700 Tm [-1000] TJ [-1500] TJ ET");
  });

  test("undoes a flipped page matrix so the text lands in page space", () => {
    const source = "1 0 0 -1 0 842 cm BT /F1 12 Tf 1 0 0 1 50 142 Tm (old) Tj ET";
    const result = strip.strip(source, fonts, [{ ...withDraws, baseline: 700, fontSize: 12, draws }]);
    expect(result.content).toContain("q 1 0 0 -1 0 842 cm 0 Tc");
  });

  test("a box without draws, or a singular matrix, is stripped without insertion", () => {
    expect(strip.strip("BT /F1 10 Tf 50 700 Td (old) Tj ET", fonts, [box]).inserted).toEqual([false]);
    const singular = strip.strip("0 0 0 0 0 0 cm BT /F1 10 Tf 50 700 Td (old) Tj ET", fonts, [{ ...withDraws, baseline: 0, left: 0 }]);
    expect(singular.inserted).toEqual([false]);
  });
});

describe("tokens", () => {
  test("decodes literal strings with escapes and nesting", () => {
    const token = tokens.nextToken("(a\\(b\\)\\101(c)\\\\)", 0)!;
    expect(String.fromCharCode(...token.bytes)).toBe("a(b)A(c)\\");
  });
  test("decodes hex strings, padding an odd digit", () => {
    expect(tokens.nextToken("<0A1>", 0)!.bytes).toEqual([10, 16]);
  });
  test("reads arrays of strings and numbers", () => {
    const token = tokens.nextToken("[(a) -20 (b)] TJ", 0)!;
    expect(token.items.map((item) => item.kind)).toEqual(["string", "number", "string"]);
    expect(token.end).toBe(13);
  });
});

describe("render.apply", () => {
  const face: layout.FontFace = { family: "sans", isBold: false, isItalic: false };

  async function sample(): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    const page = document.addPage([600, 800]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText("original wording here", { x: 50, y: 700, size: 10, font });
    page.drawText("untouched line", { x: 50, y: 680, size: 10, font });
    return document.save();
  }

  test("deletes the replaced text from the content stream instead of covering it", async () => {
    const run: layout.TextRun = { text: "original wording here", x: 50, width: 90, fontSize: 10, face };
    const line: layout.TextLine = { baseline: 700, fontSize: 10, left: 50, right: 140, hasMarker: false, runs: [run] };
    const block = { id: "b1_1", page: 1, lines: [line], text: run.text, left: 50, right: 300, fontSize: 10, face, boldWords: [], color: { r: 0, g: 0, b: 0 }, boldColor: { r: 0, g: 0, b: 0 } };
    const output = await render.apply(await sample(), [{ block, lines: ["fresh phrasing"], scale: 1, reason: "" }]);
    const page = (await PDFDocument.load(output)).getPage(0);
    const stream = page.node.Contents() as PDFRawStream | undefined;
    const content = (await PDFDocument.load(output)).context.enumerateIndirectObjects().flatMap(([, object]) => (object instanceof PDFRawStream ? [new TextDecoder().decode(decodePDFRawStream(object).decode())] : [])).join("\n");
    const hex = (text: string) => [...text].map((char) => char.charCodeAt(0).toString(16).toUpperCase()).join("");
    expect(stream).toBeDefined();
    expect(content).not.toContain(hex("original wording here"));
    expect(content).toContain(hex("untouched line"));
    expect(content).toContain(hex("fresh"));
    expect(content.indexOf(hex("fresh"))).toBeLessThan(content.indexOf(hex("untouched line")));
  });
});
