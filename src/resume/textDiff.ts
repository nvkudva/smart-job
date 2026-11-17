export interface DiffPiece {
  text: string;
  kind: "same" | "added" | "removed";
}

/** One piece per word, in order: the shared words once, plus removed and added ones. Longest common subsequence; resume lines are short, so the quadratic table is fine. */
function diffWords(before: string, after: string): DiffPiece[] {
  const oldWords = before.split(/\s+/).filter(Boolean);
  const newWords = after.split(/\s+/).filter(Boolean);
  const common: number[][] = Array.from({ length: oldWords.length + 1 }, () => new Array<number>(newWords.length + 1).fill(0));
  for (let row = oldWords.length - 1; row >= 0; row--) {
    for (let column = newWords.length - 1; column >= 0; column--) {
      common[row]![column] = oldWords[row] === newWords[column] ? common[row + 1]![column + 1]! + 1 : Math.max(common[row + 1]![column]!, common[row]![column + 1]!);
    }
  }
  const pieces: DiffPiece[] = [];
  const push = (text: string, kind: DiffPiece["kind"]) => void pieces.push({ text, kind });
  let row = 0;
  let column = 0;
  while (row < oldWords.length || column < newWords.length) {
    if (row < oldWords.length && column < newWords.length && oldWords[row] === newWords[column]) {
      push(oldWords[row]!, "same");
      row++;
      column++;
    } else if (column < newWords.length && (row === oldWords.length || common[row]![column + 1]! >= common[row + 1]![column]!)) {
      push(newWords[column]!, "added");
      column++;
    } else {
      push(oldWords[row]!, "removed");
      row++;
    }
  }
  return pieces;
}

/** The same diff with runs of one kind joined, for showing as text. */
export function wordDiff(before: string, after: string): DiffPiece[] {
  const merged: DiffPiece[] = [];
  for (const piece of diffWords(before, after)) {
    const last = merged.at(-1);
    if (last?.kind === piece.kind) last.text += ` ${piece.text}`;
    else merged.push({ ...piece });
  }
  return merged;
}

/** Per word of each text, in order: true when the word is not in the other text. */
export function changedWords(before: string, after: string): { before: boolean[]; after: boolean[] } {
  const marks = { before: [] as boolean[], after: [] as boolean[] };
  for (const piece of diffWords(before, after)) {
    if (piece.kind !== "added") marks.before.push(piece.kind === "removed");
    if (piece.kind !== "removed") marks.after.push(piece.kind === "added");
  }
  return marks;
}
