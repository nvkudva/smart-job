import { useEffect, useState } from "preact/hooks";
import * as profileExtract from "../../ai/profileExtract.ts";
import * as tasks from "../../ai/tasks.ts";
import * as resumeFile from "../../profile/resumeFile.ts";
import * as storage from "../../storage.ts";
import type { Resume } from "../../types.ts";
import * as aiContext from "../shared/aiContext.ts";
import { Button, Card, ErrorNote } from "../shared/controls.tsx";
import { useStored } from "../shared/useStored.ts";
import { useTask } from "../shared/useTask.ts";

/** Extracts a profile from the resume text and merges it into the stored one so typed fields survive. */
export async function saveExtractedProfile(text: string): Promise<void> {
  const extracted = await aiContext.run(({ client }) => tasks.extractProfile(client, text));
  const previous = await storage.get("profile");
  await storage.set("profile", profileExtract.mergeInto(previous, extracted));
}

/** In the wizard the resume saves itself (after a file read and on every edit) and extraction is left to "Build my profile". */
export function ResumeSection({ isOnboarding = false }: { isOnboarding?: boolean }) {
  const stored = useStored("resume");
  const [text, setText] = useState("");
  const [pendingFile, setPendingFile] = useState<Resume | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [isExtracted, setIsExtracted] = useState(false);
  const [hasLoadedText, setHasLoadedText] = useState(false);

  useEffect(() => {
    if (stored === undefined || hasLoadedText) return;
    setText((typed) => typed || (stored?.text ?? ""));
    setHasLoadedText(true);
  }, [stored]);

  const readFile = useTask(async (file: File) => {
    const resume = await resumeFile.read(file);
    setPendingFile(resume);
    setText(resume.text);
    setIsSaved(false);
    if (isOnboarding) await saveResume(resume, resume.text);
  });
  const saveResume = async (base: Resume, nextText: string) => {
    await storage.set("resume", { ...base, text: nextText });
    setIsSaved(true);
  };
  const baseResume = () => pendingFile ?? stored ?? { text: "", fileName: "pasted.txt", fileBase64: "", mimeType: "text/plain" };
  const save = () => saveResume(baseResume(), text);
  const extract = useTask(async () => {
    await saveExtractedProfile(text);
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
              if (isOnboarding) void saveResume(baseResume(), event.currentTarget.value);
            }}
          />
        </label>
        {stored?.fileName && stored.fileBase64 && <span class="muted small">Stored file: {stored.fileName} (attached to upload fields)</span>}
        <div class="row wrap">
          <Button kind="primary" disabled={!text.trim()} onClick={() => void save()}>
            Save resume
          </Button>
          {!isOnboarding && (
            <Button isBusy={extract.isBusy} disabled={!stored?.text || (!isSaved && text !== stored.text)} onClick={() => void extract.run()}>
              Extract profile with AI
            </Button>
          )}
          {isSaved && <span class="ok-text">Saved</span>}
          {isExtracted && <span class="ok-text">Profile updated</span>}
        </div>
        <ErrorNote message={extract.error} onRetry={() => void extract.run()} />
      </div>
    </Card>
  );
}
