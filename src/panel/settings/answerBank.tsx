import * as storage from "../../storage.ts";
import { Button, Card } from "../shared/controls.tsx";
import { useStored } from "../shared/useStored.ts";

export function AnswerBank() {
  const answers = useStored("answers");
  const entries = Object.entries(answers ?? {});
  const remove = (key: string) => storage.update("answers", (bank) => Object.fromEntries(Object.entries(bank).filter(([existing]) => existing !== key)));
  return (
    <Card title={`Answer bank (${entries.length})`}>
      {entries.length === 0 && <p class="muted">Answers you save or approve are reused on later applications.</p>}
      {entries.map(([key, entry]) => (
        <div class="bank-row">
          <div>
            <strong>{entry.question}</strong>
            <div class="muted clamp">{entry.answer}</div>
          </div>
          <Button kind="danger" aria-label={`Delete answer: ${entry.question}`} onClick={() => void remove(key)}>
            Delete
          </Button>
        </div>
      ))}
    </Card>
  );
}
