import { expect, test } from "bun:test";
import * as coverLetterPdf from "../../src/panel/documents/coverLetterPdf.ts";
import { PDFDocument } from "pdf-lib";

test("builds a PDF, paginates long text and survives non-Latin characters", async () => {
  const long = Array.from({ length: 120 }, (_, index) => `Line ${index} “quoted” 日本語 text that goes on`).join("\n\n");
  const bytes = await coverLetterPdf.build(long);
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
});
