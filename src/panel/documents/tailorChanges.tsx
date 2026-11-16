import { useState } from "preact/hooks";
import type * as rewrite from "../../resume/rewrite.ts";
import * as textDiff from "../../resume/textDiff.ts";
import { AiErrorNote, Button } from "../shared/controls.tsx";
import type { Draft } from "./tailoredPdf.ts";
import { useTask } from "../shared/useTask.ts";

export type Fit = ReturnType<typeof rewrite.fit>;

const quickInstructions: [string, string][] = [
  ["Shorter", "Make it shorter and tighter."],
  ["Stronger verbs", "Use stronger action verbs."],
  ["More polite", "Make the tone more polite and formal."],
  ["Job's words", "Use more of the job posting's own terms, only where the resume supports it."],
];

function DiffText({ pieces, hide, mark }: { pieces: textDiff.DiffPiece[]; hide: textDiff.DiffPiece["kind"]; mark: "added" | "removed" }) {
  return (
    <>
      {pieces
        .filter((piece) => piece.kind !== hide)
        .map((piece) => (piece.kind === mark ? <mark class={`diff-${mark}`}>{piece.text} </mark> : <span>{piece.text} </span>))}
    </>
  );
}

function AskAi({ onAsk }: { onAsk: (instruction: string) => Promise<void> }) {
  const [instruction, setInstruction] = useState("");
  const ask = useTask(async (text: string) => {
    await onAsk(text);
    setInstruction("");
  });
  const send = (text: string) => text.trim() && void ask.run(text);
  return (
    <div class="stack tight">
      <div class="chips">
        {quickInstructions.map(([label, text]) => (
          <button type="button" class="chip pick" disabled={ask.isBusy} onClick={() => send(text)}>
            {label}
          </button>
        ))}
      </div>
      <div class="row">
        <input
          type="text"
          class="grow"
          placeholder="Tell the AI what to change…"
          aria-label="Instruction for this line"
          value={instruction}
          onInput={(event) => setInstruction(event.currentTarget.value)}
          onKeyDown={(event) => event.key === "Enter" && send(instruction)}
        />
        <Button isBusy={ask.isBusy} disabled={!instruction.trim()} onClick={() => send(instruction)}>
          Ask AI
        </Button>
      </div>
      <AiErrorNote message={ask.error} />
    </div>
  );
}

interface ChangeCardProps {
  draft: Draft;
  fit: Fit;
  maxChars: number;
  onChange: (patch: Partial<Draft>) => void;
  onAsk: (instruction: string) => Promise<void>;
}

/** One rewritten line: what it said, what it says now (click to edit), and a way to steer the AI on just this line. */
export function ChangeCard({ draft, fit, maxChars, onChange, onAsk }: ChangeCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const before = draft.block.text;
  const pieces = textDiff.wordDiff(before, fit.cleaned);
  const overBy = "overBy" in fit ? fit.overBy : 0;
  return (
    <div class={`tcard${draft.isOn ? "" : " off"}${overBy ? " over" : ""}`}>
      <div class="row between">
        <span class={`small ${overBy ? "required" : "muted"}`}>{fit.cleaned.length}/{maxChars} characters</span>
        <Button onClick={() => onChange({ isOn: !draft.isOn })}>{draft.isOn ? "Revert line" : "Re-apply"}</Button>
      </div>
      <div class="tline before">
        <DiffText pieces={pieces} hide="added" mark="removed" />
      </div>
      {draft.isOn &&
        (isEditing ? (
          <textarea
            class="tline"
            rows={Math.max(2, Math.ceil(draft.text.length / 38))}
            aria-label="Edit this line"
            value={draft.text}
            autoFocus
            onInput={(event) => onChange({ text: event.currentTarget.value, isEdited: true })}
            onBlur={() => setIsEditing(false)}
          />
        ) : (
          <div class="tline after" role="button" tabIndex={0} title="Click to edit" onClick={() => setIsEditing(true)} onKeyDown={(event) => event.key === "Enter" && setIsEditing(true)}>
            <DiffText pieces={pieces} hide="removed" mark="added" />
            <span class="muted small">✎</span>
          </div>
        ))}
      {overBy > 0 && <div class="small required">{overBy} characters too long for this line. Shorten it, ask the AI, or revert the line.</div>}
      {!overBy && fit.cleaned !== draft.text.trim() && <div class="small muted">Prints as: {fit.cleaned}</div>}
      {draft.reason && <div class="small muted">{draft.reason}</div>}
      {draft.isOn && <AskAi onAsk={onAsk} />}
    </div>
  );
}
