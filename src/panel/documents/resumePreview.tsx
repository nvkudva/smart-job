import * as pdfjs from "pdfjs-dist";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import * as preview from "../../resume/preview.ts";
import { Button, Card } from "../shared/controls.tsx";

const renderScale = 2;

function addHighlights(wrapper: HTMLElement, changes: preview.PreviewChange[], pageNumber: number, view: number[]): void {
  for (const change of changes.filter((item) => item.page === pageNumber)) {
    for (const rect of change.rects) {
      const mark = document.createElement("div");
      mark.className = "preview-mark";
      Object.assign(mark.style, preview.toPercent(rect, view));
      wrapper.append(mark);
    }
  }
}

async function drawPages(container: HTMLElement, base64: string, changes: preview.PreviewChange[], signal: AbortSignal): Promise<void> {
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs");
  const loading = pdfjs.getDocument({ data: preview.fromBase64(base64) });
  const pdf = await loading.promise;
  container.replaceChildren();
  for (let number = 1; number <= pdf.numPages && !signal.aborted; number++) {
    const page = await pdf.getPage(number);
    const viewport = page.getViewport({ scale: renderScale });
    const wrapper = document.createElement("div");
    wrapper.className = "preview-page";
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    wrapper.append(canvas);
    addHighlights(wrapper, changes, number, page.view);
    container.append(wrapper);
    await page.render({ canvasContext: canvas.getContext("2d")!, canvas, viewport }).promise;
  }
}

function PdfPane({ title, base64, changes }: { title: string; base64: string; changes: preview.PreviewChange[] }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!container.current) return;
    const controller = new AbortController();
    drawPages(container.current, base64, changes, controller.signal).catch((failure) => setError(String(failure)));
    return () => controller.abort();
  }, [base64, changes]);
  return (
    <section class="preview-pane">
      <h2>{title}</h2>
      {error && <div class="error">{error}</div>}
      <div ref={container} />
    </section>
  );
}

function ChangeList({ changes }: { changes: preview.PreviewChange[] }) {
  return (
    <Card title={`Changes (${changes.length})`}>
      {changes.length === 0 && <p class="muted">No lines were changed.</p>}
      {changes.map((change) => (
        <div class="change">
          <div class="muted small">Page {change.page}</div>
          <div class="before">{change.before}</div>
          <div class="after">→ {change.after}</div>
          <div class="muted small">{change.reason}</div>
        </div>
      ))}
    </Card>
  );
}

function usePreview(): preview.TailoredPreview | null | undefined {
  const [current, setCurrent] = useState<preview.TailoredPreview | null | undefined>(undefined);
  useEffect(() => {
    const reload = () => void preview.load().then(setCurrent);
    reload();
    chrome.storage.onChanged.addListener(reload);
    return () => chrome.storage.onChanged.removeListener(reload);
  }, []);
  return current;
}

function Preview() {
  const current = usePreview();
  if (current === undefined) return <p class="muted preview-empty">Loading…</p>;
  if (current === null) return <p class="muted preview-empty">Nothing to preview yet. Generate a tailored resume from the SmartJob side panel (Write tab).</p>;
  const download = () => preview.downloadPdf(current.fileName, preview.fromBase64(current.tailoredBase64));
  return (
    <div class="preview-root">
      <header class="preview-head">
        <div>
          <h1>Tailored resume</h1>
          <div class="muted">
            {current.jobTitle}
            {current.company && ` @ ${current.company}`} · changed lines are highlighted
          </div>
        </div>
        <Button kind="primary" onClick={download}>
          Download tailored PDF
        </Button>
      </header>
      <div class="preview-grid">
        <PdfPane title="Original" base64={current.originalBase64} changes={current.changes} />
        <PdfPane title="Tailored" base64={current.tailoredBase64} changes={current.changes} />
        <aside class="preview-changes">
          <ChangeList changes={current.changes} />
        </aside>
      </div>
    </div>
  );
}

render(<Preview />, document.getElementById("root")!);
