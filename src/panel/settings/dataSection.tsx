import * as storage from "../../storage.ts";
import { Button, Card, ErrorNote, FileButton } from "../shared/controls.tsx";
import * as download from "../shared/download.ts";
import { useTask } from "../shared/useTask.ts";

export function DataSection() {
  const importFile = useTask(async (file: File) => {
    await storage.importAll(await file.text());
    location.reload();
  });
  const exportAll = async () => download.save("smartjob-data.json", await storage.exportAll(), "application/json");
  const clearAll = async () => {
    if (!confirm("Delete your resume, profile, tracker, answers and settings? This cannot be undone.")) return;
    await storage.clearAll();
    location.reload();
  };
  return (
    <>
      <Card title="Your data">
        <p class="muted">Everything is stored in this browser. Nothing leaves it except calls to your chosen AI endpoint and salary search.</p>
        <div class="actions start">
          <Button onClick={() => void exportAll()}>Export JSON</Button>
          <FileButton accept="application/json,.json" isBusy={importFile.isBusy} onFile={(file) => void importFile.run(file)}>
            Import JSON
          </FileButton>
          <span class="push">
            <Button kind="danger" onClick={() => void clearAll()}>
              Clear all
            </Button>
          </span>
        </div>
        <ErrorNote message={importFile.error} />
      </Card>
    </>
  );
}
