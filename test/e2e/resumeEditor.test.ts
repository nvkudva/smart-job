import { afterAll, beforeAll, expect, test } from "bun:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as harness from "./harness.ts";

let h: harness.Harness;
beforeAll(async () => {
  h = await harness.launch();
});
afterAll(async () => {
  await h?.close();
});

async function sampleResumeBase64(): Promise<string> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText("•", { x: 45, y: 700, size: 10, font });
  page.drawText("Led a team of platform engineers building payments", { x: 54, y: 700, size: 10, font });
  return pdf.saveAsBase64();
}

test("the editor renders both pages, edits a line in place and saves the new PDF", async () => {
  const base64 = await sampleResumeBase64();
  const job = { id: "1", url: "https://x.test/1", title: "Platform Engineer", company: "Globex", location: "", description: "", salaryText: "", employmentType: "", source: "generic" };
  await h.seed({ tailoredPreview: { job, fileName: "resume-tailored.pdf", originalBase64: base64, tailoredBase64: base64, drafts: [], revision: 1, source: "panel" } });

  const page = await h.context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`chrome-extension://${h.extensionId}/resumePreview.html`);
  await page.locator(".preview-pane").nth(1).locator(".preview-mark.block").first().waitFor({ state: "attached", timeout: 15000 });

  await page.locator(".preview-pane").nth(1).locator(".preview-mark.block").first().click({ force: true });
  await page.locator(".tline.after").click();
  await page.getByLabel("Edit this line").fill("Led a team of senior engineers building payments");
  const readSlot = () => page.evaluate(async () => (await chrome.storage.local.get("tailoredPreview")).tailoredPreview as { source: string });
  for (let attempt = 0; attempt < 60 && (await readSlot()).source !== "editor"; attempt++) await new Promise((resolve) => setTimeout(resolve, 250));
  await page.getByText("Saved", { exact: true }).waitFor({ timeout: 15000 });
  await page.locator(".preview-pane").nth(1).locator(".preview-mark.added").first().waitFor({ state: "attached", timeout: 15000 });

  const saved = (await page.evaluate(async () => (await chrome.storage.local.get("tailoredPreview")).tailoredPreview)) as { tailoredBase64: string; drafts: { text: string }[]; source: string };
  expect(saved.source).toBe("editor");
  expect(saved.drafts[0]!.text).toContain("senior");
  expect(saved.tailoredBase64).not.toBe(base64);
  expect(errors).toEqual([]);
}, 60000);
