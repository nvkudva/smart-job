import { useEffect, useState } from "preact/hooks";
import * as profileExtract from "../../ai/profileExtract.ts";
import * as tasks from "../../ai/tasks.ts";
import * as resumeFile from "../../profile/resumeFile.ts";
import * as storage from "../../storage.ts";
import type { Resume } from "../../types.ts";
import * as aiContext from "../shared/aiContext.ts";
import { Button, ErrorNote, FileButton } from "../shared/controls.tsx";
import { useStored } from "../shared/useStored.ts";
import { useTask } from "../shared/useTask.ts";

/** Extracts a profile from the resume text and merges it into the stored one so typed fields survive. */
export async function saveExtractedProfile(text: string): Promise<void> {
  const withLinks = await resumeFile.addStoredLinks(await storage.get("resume"), text);
  const extracted = await aiContext.run(({ client }) => tasks.extractProfile(client, withLinks));
  const previous = await storage.get("profile");
  await storage.set("profile", profileExtract.mergeInto(previous, extracted));
}

/** In the wizard the resume saves itself (after a file read and on every edit) and extraction is left to "Build my profile". */
export function ResumeFields({ isOnboarding = false }: { isOnboarding?: boolean }) {
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
  const isDirty = !!pendingFile && !isSaved || text !== (stored?.text ?? "");
  const extract = useTask(async () => {
    await saveExtractedProfile(text);
    setIsExtracted(true);
  });

  return (
    <div class="stack tight">
      <div class="row between">
        <span class="muted small clamp">{(pendingFile ?? stored)?.fileName || "No file chosen"}</span>
        <FileButton accept=".pdf,.txt,.md,application/pdf,text/plain" isBusy={readFile.isBusy} onFile={(file) => void readFile.run(file)}>
          Choose file
        </FileButton>
      </div>
      <ErrorNote message={readFile.error} />
      <label class="field area">
        <textarea
          rows={8}
          placeholder=" "
          aria-label="Resume text"
          value={text}
          onInput={(event) => {
            setText(event.currentTarget.value);
            setIsSaved(false);
            if (isOnboarding) void saveResume(baseResume(), event.currentTarget.value);
          }}
        />
        <span>or paste text</span>
      </label>
      {stored?.fileName && stored.fileBase64 && <span class="muted small">Stored file: {stored.fileName} (attached to upload fields)</span>}
      <div class="actions">
        <span class="grow ok-text">{isExtracted ? "Profile updated" : isSaved ? "Saved" : ""}</span>
        {!isOnboarding && (
          <Button isBusy={extract.isBusy} disabled={!stored?.text || isDirty} onClick={() => void extract.run()}>
            Extract profile with AI
          </Button>
        )}
        <Button kind={isOnboarding ? "ghost" : "primary"} disabled={!text.trim() || !isDirty} onClick={() => void save()}>
          Save resume
        </Button>
      </div>
      <ErrorNote message={extract.error} onRetry={() => void extract.run()} />
    </div>
  );
}
