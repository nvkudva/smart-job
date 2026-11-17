import { cp, mkdir, rm } from "node:fs/promises";

const outdir = "dist";
await rm(outdir, { recursive: true, force: true }); // a clean dist keeps dev-only files out of the zip
await mkdir(outdir, { recursive: true });

const entries = [
  { entry: "src/background.ts", name: "background.js", format: "esm" },
  { entry: "src/content/index.ts", name: "content.js", format: "iife" },
  { entry: "src/panel/main.tsx", name: "panel.js", format: "esm" },
  { entry: "src/panel/documents/resumePreview.tsx", name: "resumePreview.js", format: "esm" },
  { entry: "src/superjob/page.tsx", name: "superjob.js", format: "esm" },
] as const;

for (const { entry, name, format } of entries) {
  const result = await Bun.build({ entrypoints: [entry], outdir, target: "browser", format, naming: name, sourcemap: "linked" });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}
await cp("static", outdir, { recursive: true });
await cp("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", `${outdir}/pdf.worker.min.mjs`);
console.log("built", outdir);
