import { PDFDocument, StandardFonts } from "pdf-lib";

const pageWidth = 612;
const pageHeight = 792;
const margin = 72;
const fontSize = 11;
const lineHeight = 15;

const lookalikes: Record<string, string> = { "’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "..." };

/** shortcut: Helvetica only draws Latin-1, so other scripts become "?"; embed a Unicode font if non-Latin letters are needed. */
const toLatin1 = (text: string) => text.replace(/[^\n\x20-\x7E\xA0-\xFF]/g, (char) => lookalikes[char] ?? "?");

/** A plain letter-size PDF of the letter, one paragraph block per blank line, wrapped to the page width. */
export async function build(letter: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const maxWidth = pageWidth - margin * 2;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawLine = (line: string) => {
    if (y < margin) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    if (line) page.drawText(line, { x: margin, y, size: fontSize, font });
    y -= lineHeight;
  };

  for (const paragraphLine of toLatin1(letter).split("\n")) {
    let current = "";
    for (const word of paragraphLine.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
        drawLine(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    drawLine(current);
  }
  return pdf.save();
}
