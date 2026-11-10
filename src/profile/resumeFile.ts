import * as pdfjs from "pdfjs-dist";
import type { Resume } from "../types.ts";

interface TextPiece {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
}

/** Joins pdf.js text items into lines: break on hasEOL or when the baseline moves. */
export function joinLines(items: TextPiece[]): string {
  let text = "";
  let lastY: number | null = null;
  for (const item of items) {
    const y = item.transform?.[5] ?? null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !text.endsWith("\n")) text += "\n";
    text += item.str;
    if (item.hasEOL) text += "\n";
    if (y !== null) lastY = y;
  }
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function toBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

async function readPdfText(bytes: Uint8Array): Promise<string> {
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs");
  // pdf.js transfers the buffer to its worker, so give it a copy
  const document = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const pages: string[] = [];
  for (let number = 1; number <= document.numPages; number++) {
    const content = await (await document.getPage(number)).getTextContent();
    pages.push(joinLines(content.items.filter((item): item is typeof item & TextPiece => "str" in item)));
  }
  return pages.join("\n\n");
}

export async function read(file: File): Promise<Resume> {
  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (name.endsWith(".docx")) throw new Error("DOCX not supported yet — upload PDF or paste text");
  const isPdf = name.endsWith(".pdf") || file.type === "application/pdf";
  const isText = /\.(txt|md|markdown)$/.test(name) || file.type.startsWith("text/");
  if (!isPdf && !isText) throw new Error("Unsupported file type — upload PDF, TXT or MD, or paste text");
  const text = isPdf ? await readPdfText(bytes) : new TextDecoder().decode(bytes);
  return { text: text.trim(), fileName: file.name, fileBase64: toBase64(bytes), mimeType: isPdf ? "application/pdf" : file.type || "text/plain" };
}
