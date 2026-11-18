import { useState } from "preact/hooks";
import * as storage from "../../storage.ts";
import * as diagnostics from "./diagnostics.ts";
import { Button, Card, ErrorNote, FileButton } from "../shared/controls.tsx";
import * as download from "../shared/download.ts";
import * as trackerCsv from "../tracker/trackerCsv.ts";
import { useStored } from "../shared/useStored.ts";
import { useTask } from "../shared/useTask.ts";

export function DataSection() {
  const jobs = useStored("jobs");
  const resumes = useStored("tailoredResumes");
  const importFile = useTask(async (file: File) => {
    await storage.importAll(await file.text());
    location.reload();
  });
  const [copyNote, setCopyNote] = useState("");
  const copy = useTask(async (copier: () => Promise<string>) => {
    setCopyNote("");
    setCopyNote(await copier());
  });
  const exportAll = async () => download.save("smartjob-data.json", await storage.exportAll(), "application/json");
  const exportTracker = () => download.save("smartjob-tracker.csv", trackerCsv.build(Object.values(jobs ?? {}), resumes ?? []), "text/csv");
  const clearAll = async () => {
    if (!confirm("Delete your resume, profile, tracker, answers and settings? This cannot be undone.")) return;
    await storage.clearAll();
    location.reload();
  };
  return (
    <>
      <Card title="Your data">
        <p class="muted">Everything is stored in this browser. Nothing leaves it except calls to your chosen AI endpoint, and salary and perks search.</p>
        <div class="actions even">
          <Button onClick={() => void exportAll()}>Export JSON</Button>
          <Button disabled={!jobs || Object.keys(jobs).length === 0} onClick={exportTracker}>
            Export tracker CSV
          </Button>
          <FileButton accept="application/json,.json" isBusy={importFile.isBusy} onFile={(file) => void importFile.run(file)}>
            Import JSON
          </FileButton>
          <Button kind="danger" onClick={() => void clearAll()}>
            Clear all
          </Button>
        </div>
        <ErrorNote message={importFile.error} />
      </Card>
      <Card title="Troubleshooting">
        <p class="muted">Copy these as JSON when you report a form SmartJob Assistant could not fill. The field scan reads the tab you have open.</p>
        <div class="actions">
          <span class="grow muted small">{copy.error || copyNote}</span>
          <Button isBusy={copy.isBusy} onClick={() => void copy.run(diagnostics.copyFieldScan)}>
            Copy field scan
          </Button>
          <Button isBusy={copy.isBusy} onClick={() => void copy.run(diagnostics.copyFillLog)}>
            Copy fill log
          </Button>
        </div>
      </Card>
    </>
  );
}
