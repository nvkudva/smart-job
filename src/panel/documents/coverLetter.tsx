import { useState } from "preact/hooks";
import * as tasks from "../../ai/tasks.ts";
import type { JobPosting, TrackedJob } from "../../types.ts";
import * as aiContext from "../shared/aiContext.ts";
import { Button, Card, Choice, AiErrorNote, ErrorNote } from "../shared/controls.tsx";
import * as session from "../../fill/session.ts";
import { toBase64 } from "../../profile/resumeFile.ts";
import * as coverLetterPdf from "./coverLetterPdf.ts";
import * as markdown from "./markdown.ts";
import * as trackedJobs from "../job/trackedJobs.ts";
import { useTask } from "../shared/useTask.ts";

type Tone = "professional" | "enthusiastic" | "concise";

export function CoverLetter({ job, tabId, tracked }: { job: JobPosting; tabId: number | null; tracked: TrackedJob | undefined }) {
  const [tone, setTone] = useState<Tone>("professional");
  const [words, setWords] = useState("150");
  const [letter, setLetter] = useState(tracked?.coverLetter ?? "");
  const [isCopied, setIsCopied] = useState(false);

  const generate = useTask(async () => {
    const text = await aiContext.run(({ client, candidate }) => tasks.writeCoverLetter(client, job, candidate, { tone, words: Number(words) }));
    setLetter(text);
    await trackedJobs.track(job, { coverLetter: text });
  });
  const attach = useTask(async () => {
    if (!tabId) throw new Error("Open the application page in this tab first.");
    const bytes = await coverLetterPdf.build(letter);
    const name = `Cover-letter-${job.company || "job"}.pdf`.replace(/\s+/g, "-");
    await session.attachFile(tabId, { name, base64: toBase64(bytes), mimeType: "application/pdf" }, "cover letter");
  });
  const copy = async () => {
    await navigator.clipboard.writeText(letter);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  };

  return (
    <Card title="Cover letter">
      <div class="grid2">
        <Choice label="Tone" value={tone} options={[["professional", "Conversational"], ["enthusiastic", "Enthusiastic"], ["concise", "Opener + 3 bullets"]]} onValue={(value) => setTone(value as Tone)} />
        <Choice label="Length" value={words} options={[["120", "Short (~120 words)"], ["150", "Standard (~150 words)"], ["180", "Fuller (~180 words)"]]} onValue={setWords} />
      </div>
      <Button kind="primary" isBusy={generate.isBusy} onClick={() => void generate.run()}>
        {letter ? "Regenerate" : "Generate"}
      </Button>
      <AiErrorNote message={generate.error} onRetry={() => void generate.run()} />
      {letter && (
        <>
          <textarea
            rows={10}
            aria-label="Cover letter text"
            value={letter}
            onInput={(event) => setLetter(event.currentTarget.value)}
            onBlur={() => void trackedJobs.track(job, { coverLetter: letter })}
          />
          <div class="actions">
            <Button onClick={() => void copy()}>{isCopied ? "Copied" : "Copy"}</Button>
            <Button onClick={() => markdown.openPrintable(letter, `Cover letter - ${job.company || job.title}`)}>Download PDF</Button>
            <Button isBusy={attach.isBusy} onClick={() => void attach.run()}>Attach to form</Button>
          </div>
          {attach.error && <ErrorNote message={attach.error} />}
        </>
      )}
    </Card>
  );
}
