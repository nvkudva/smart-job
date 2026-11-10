import { useState } from "preact/hooks";
import * as tasks from "../ai/tasks.ts";
import type { JobPosting } from "../types.ts";
import * as aiContext from "./aiContext.ts";
import { Button, Card, ErrorNote } from "./controls.tsx";
import * as markdown from "./markdown.ts";
import { useTask } from "./useTask.ts";

type Tailored = Awaited<ReturnType<typeof tasks.tailorResume>>;

export function TailorResume({ job }: { job: JobPosting }) {
  const [changes, setChanges] = useState<Tailored["changes"]>([]);
  const [text, setText] = useState("");
  const generate = useTask(async () => {
    const tailored = await aiContext.run(({ client, candidate }) => tasks.tailorResume(client, job, candidate));
    setChanges(tailored.changes);
    setText(tailored.markdown);
  });

  return (
    <Card title="Tailored resume">
      <p class="muted small">Rewrites your summary and bullets toward this job without adding facts. Review every change.</p>
      <Button kind="primary" isBusy={generate.isBusy} onClick={() => void generate.run()}>
        {text ? "Regenerate" : "Generate"}
      </Button>
      <ErrorNote message={generate.error} onRetry={() => void generate.run()} />
      {changes.length > 0 && (
        <div class="block">
          <h4>Changes ({changes.length})</h4>
          {changes.map((change) => (
            <div class="change">
              {change.before && <div class="before">{change.before}</div>}
              <div class="after">→ {change.after}</div>
              <div class="muted small">{change.reason}</div>
            </div>
          ))}
        </div>
      )}
      {text && (
        <>
          <textarea rows={14} aria-label="Tailored resume markdown" value={text} onInput={(event) => setText(event.currentTarget.value)} />
          <Button onClick={() => markdown.openPrintable(text, `Resume - ${job.title}`)}>Open printable PDF</Button>
        </>
      )}
    </Card>
  );
}
