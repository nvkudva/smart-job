import type { AnswerBank as Answers } from "../../types.ts";
import { Button, Card, Field } from "../shared/controls.tsx";

type Answer = Answers[string];

/** Unsaved changes by answer key; null means deleted. The profile's Save button writes them. */
export type AnswerEdits = Record<string, Answer | null>;

export function AnswerBank({ answers, edits, onEdit }: { answers: Answers; edits: AnswerEdits; onEdit: (key: string, answer: Answer | null) => void }) {
  const entries = Object.entries(answers).filter(([key]) => edits[key] !== null);
  return (
    <Card title={`Answer bank (${entries.length})`}>
      {entries.length === 0 && <p class="muted">Answers you save or approve are reused on later applications.</p>}
      {entries.map(([key, saved]) => {
        const entry = edits[key] ?? saved;
        return (
          <div class="bank-row resume-row">
            <div class="row between">
              <strong>{entry.question}</strong>
              <Button kind="danger" aria-label={`Delete answer: ${entry.question}`} onClick={() => onEdit(key, null)}>
                Delete
              </Button>
            </div>
            <Field label="Answer" rows={3} value={entry.answer} onValue={(answer) => onEdit(key, { ...entry, answer })} />
          </div>
        );
      })}
    </Card>
  );
}
