import { useState } from "preact/hooks";
import * as tasks from "../ai/tasks.ts";
import type { JobPosting, TrackedJob } from "../types.ts";
import * as aiContext from "./aiContext.ts";
import { Button, Card, Choice, ErrorNote } from "./controls.tsx";
import * as download from "./download.ts";
import * as trackedJobs from "./trackedJobs.ts";
import { useTask } from "./useTask.ts";

type Tone = "professional" | "enthusiastic" | "concise";

export function CoverLetter({ job, tracked }: { job: JobPosting; tracked: TrackedJob | undefined }) {
  const [tone, setTone] = useState<Tone>("professional");
  const [words, setWords] = useState("250");
  const [letter, setLetter] = useState(tracked?.coverLetter ?? "");
  const [isCopied, setIsCopied] = useState(false);

  const generate = useTask(async () => {
    const text = await aiContext.run(({ client, candidate }) => tasks.writeCoverLetter(client, job, candidate, { tone, words: Number(words) }));
    setLetter(text);
    if (tracked) await trackedJobs.track(job, { coverLetter: text });
  });
  const copy = async () => {
    await navigator.clipboard.writeText(letter);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  };

  return (
    <Card title="Cover letter">
      <div class="grid2">
        <Choice label="Tone" value={tone} options={["professional", "enthusiastic", "concise"]} onValue={(value) => setTone(value as Tone)} />
        <Choice label="Length" value={words} options={[["150", "150 words"], ["250", "250 words"], ["350", "350 words"]]} onValue={setWords} />
      </div>
      <Button kind="primary" isBusy={generate.isBusy} onClick={() => void generate.run()}>
        {letter ? "Regenerate" : "Generate"}
      </Button>
      <ErrorNote message={generate.error} onRetry={() => void generate.run()} />
      {letter && (
        <>
          <textarea
            rows={12}
            aria-label="Cover letter text"
            value={letter}
            onInput={(event) => setLetter(event.currentTarget.value)}
            onBlur={() => tracked && void trackedJobs.track(job, { coverLetter: letter })}
          />
          <div class="row wrap">
            <Button onClick={() => void copy()}>{isCopied ? "Copied" : "Copy"}</Button>
            <Button onClick={() => download.save(`cover-letter-${job.company || "job"}.txt`.replace(/\s+/g, "-"), letter, "text/plain")}>Download .txt</Button>
          </div>
        </>
      )}
    </Card>
  );
}
