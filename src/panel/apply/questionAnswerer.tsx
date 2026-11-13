import { useState } from "preact/hooks";
import * as tasks from "../../ai/tasks.ts";
import * as mapping from "../../fill/mapping.ts";
import * as storage from "../../storage.ts";
import type { JobPosting } from "../../types.ts";
import * as aiContext from "../shared/aiContext.ts";
import { Button, Card, ErrorNote } from "../shared/controls.tsx";
import { useTask } from "../shared/useTask.ts";

export function QuestionAnswerer({ job }: { job: JobPosting | null }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [isSaved, setIsSaved] = useState(false);

  const generate = useTask(async () => {
    const text = await aiContext.run(({ client, candidate }) => tasks.answerQuestion(client, question, candidate, job));
    setAnswer(text);
    setIsSaved(false);
  });
  const saveToBank = async () => {
    await storage.update("answers", (bank) => ({ ...bank, [mapping.normalize(question)]: { question: question.trim(), answer, updatedAt: Date.now() } }));
    setIsSaved(true);
  };

  return (
    <Card title="Answer a question">
      <textarea rows={3} placeholder="Paste any application question" aria-label="Application question" value={question} onInput={(event) => setQuestion(event.currentTarget.value)} />
      <Button kind="primary" isBusy={generate.isBusy} disabled={!question.trim()} onClick={() => void generate.run()}>
        Answer
      </Button>
      <ErrorNote message={generate.error} onRetry={() => void generate.run()} />
      {answer && (
        <>
          <textarea rows={6} aria-label="Answer" value={answer} onInput={(event) => setAnswer(event.currentTarget.value)} />
          <Button onClick={() => void saveToBank()}>{isSaved ? "Saved to answer bank" : "Save to answer bank"}</Button>
        </>
      )}
    </Card>
  );
}
