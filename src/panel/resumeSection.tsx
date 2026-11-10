import { useEffect, useState } from "preact/hooks";
import * as tasks from "../ai/tasks.ts";
import * as resumeFile from "../profile/resumeFile.ts";
import * as storage from "../storage.ts";
import type { Resume } from "../types.ts";
import * as aiContext from "./aiContext.ts";
import { Button, Card, ErrorNote } from "./controls.tsx";
import { useStored } from "./useStored.ts";
import { useTask } from "./useTask.ts";

export function ResumeSection() {
  const stored = useStored("resume");
  const [text, setText] = useState("");
  const [pendingFile, setPendingFile] = useState<Resume | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [isExtracted, setIsExtracted] = useState(false);
  const [hasLoadedText, setHasLoadedText] = useState(false);

  useEffect(() => {
    if (stored === undefined || hasLoadedText) return;
    setText(stored?.text ?? "");
    setHasLoadedText(true);
  }, [stored]);

  const readFile = useTask(async (file: File) => {
    const resume = await resumeFile.read(file);
    setPendingFile(resume);
    setText(resume.text);
    setIsSaved(false);
  });
  const save = async () => {
    const base = pendingFile ?? stored ?? { text: "", fileName: "pasted.txt", fileBase64: "", mimeType: "text/plain" };
    await storage.set("resume", { ...base, text });
    setPendingFile(null);
    setIsSaved(true);
  };
  const extract = useTask(async () => {
    const profile = await aiContext.run(({ client }) => tasks.extractProfile(client, text));
    await storage.set("profile", profile);
    setIsExtracted(true);
  });

  return (
    <Card title="Resume">
      <div class="stack tight">
        <label class="field">
          <span>Upload PDF or TXT</span>
          <input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" onChange={(event) => event.currentTarget.files?.[0] && void readFile.run(event.currentTarget.files[0])} />
        </label>
        {readFile.isBusy && <span class="muted">Reading file…</span>}
        <ErrorNote message={readFile.error} />
        <label class="field">
          <span>or paste text</span>
          <textarea
            rows={8}
            aria-label="Resume text"
            value={text}
            onInput={(event) => {
              setText(event.currentTarget.value);
              setIsSaved(false);
            }}
          />
        </label>
        {stored?.fileName && stored.fileBase64 && <span class="muted small">Stored file: {stored.fileName} (attached to upload fields)</span>}
        <div class="row wrap">
          <Button kind="primary" disabled={!text.trim()} onClick={() => void save()}>
            Save resume
          </Button>
          <Button isBusy={extract.isBusy} disabled={!stored?.text || !isSaved && text !== stored.text} onClick={() => void extract.run()}>
            Extract profile with AI
          </Button>
          {isSaved && <span class="ok-text">Saved</span>}
          {isExtracted && <span class="ok-text">Profile updated</span>}
        </div>
        <ErrorNote message={extract.error} onRetry={() => void extract.run()} />
      </div>
    </Card>
  );
}
