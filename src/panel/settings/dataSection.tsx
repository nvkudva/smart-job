import * as storage from "../../storage.ts";
import { Button, Card, ErrorNote } from "../shared/controls.tsx";
import * as download from "../shared/download.ts";
import { useStored } from "../shared/useStored.ts";
import { useTask } from "../shared/useTask.ts";

function AnswerBank() {
  const answers = useStored("answers");
  const entries = Object.entries(answers ?? {});
  const remove = (key: string) => storage.update("answers", (bank) => Object.fromEntries(Object.entries(bank).filter(([existing]) => existing !== key)));
  return (
    <Card title={`Answer bank (${entries.length})`}>
      {entries.length === 0 && <p class="muted">Answers you save or approve are reused on later applications.</p>}
      {entries.map(([key, entry]) => (
        <div class="bank-row">
          <div>
            <strong class="small">{entry.question}</strong>
            <div class="muted small clamp">{entry.answer}</div>
          </div>
          <Button kind="danger" aria-label={`Delete answer: ${entry.question}`} onClick={() => void remove(key)}>
            Delete
          </Button>
        </div>
      ))}
    </Card>
  );
}

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
      <AnswerBank />
      <Card title="Your data">
        <p class="muted small">Everything is stored in this browser. Nothing leaves it except calls to your chosen AI endpoint and salary search.</p>
        <div class="row wrap">
          <Button onClick={() => void exportAll()}>Export JSON</Button>
          <label class="btn ghost file-btn">
            Import JSON
            <input type="file" accept="application/json,.json" hidden onChange={(event) => event.currentTarget.files?.[0] && void importFile.run(event.currentTarget.files[0])} />
          </label>
          <Button kind="danger" onClick={() => void clearAll()}>
            Clear all
          </Button>
        </div>
        <ErrorNote message={importFile.error} />
      </Card>
    </>
  );
}
