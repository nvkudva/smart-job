import * as tokens from "./contentTokens.ts";
import * as drawOps from "./drawOps.ts";

export interface FontMetrics {
  isTwoByte: boolean;
  /** advance of a character code in 1/1000 em */
  widthOf(code: number): number;
}

export type FontLookup = (name: string) => FontMetrics | undefined;

export interface LineBox {
  left: number;
  right: number;
  baseline: number;
  fontSize: number;
  /** new text to emit into the stream where this line's first original text operator was */
  draws?: drawOps.Draw[];
}

export interface StripResult {
  content: string;
  /** per input box: whether any text-showing operator was removed from it */
  hits: boolean[];
  /** per input box: whether its draws were written into the stream */
  inserted: boolean[];
}

type Matrix = drawOps.Matrix;

const identity: Matrix = [1, 0, 0, 1, 0, 0];
const baselineTolerance = 0.3;
const leftTolerance = 0.5;
const rightTolerance = 1.5;
const fallbackWidth = 500;

function multiply(first: Matrix, second: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = second;
  return [a1 * a2 + b1 * c2, a1 * b2 + b1 * d2, c1 * a2 + d1 * c2, c1 * b2 + d1 * d2, e1 * a2 + f1 * c2 + e2, e1 * b2 + f1 * d2 + f2];
}

const translation = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];

/** Index of the box whose line contains a glyph drawn at (x, y), or -1. */
export function boxAt(boxes: LineBox[], x: number, y: number): number {
  return boxes.findIndex(
    (box) => Math.abs(y - box.baseline) <= box.fontSize * baselineTolerance && x >= box.left - leftTolerance && x <= box.right + rightTolerance,
  );
}

interface Graphics {
  ctm: Matrix;
  saved: Matrix[];
  tm: Matrix;
  lineMatrix: Matrix;
  font: FontMetrics | undefined;
  fontSize: number;
  charSpace: number;
  wordSpace: number;
  scale: number;
  leading: number;
  rise: number;
  inText: boolean;
}

function newGraphics(): Graphics {
  return { ctm: identity, saved: [], tm: identity, lineMatrix: identity, font: undefined, fontSize: 0, charSpace: 0, wordSpace: 0, scale: 1, leading: 0, rise: 0, inText: false };
}

function moveLine(state: Graphics, x: number, y: number): void {
  state.lineMatrix = multiply(translation(x, y), state.lineMatrix);
  state.tm = state.lineMatrix;
}

function glyphOrigin(state: Graphics): { x: number; y: number } {
  const [, , , , x, y] = multiply(multiply(translation(0, state.rise), state.tm), state.ctm);
  return { x, y };
}

function advanceBy(state: Graphics, code: number, isSpace: boolean): number {
  const width = (state.font?.widthOf(code) ?? fallbackWidth) / 1000;
  const shift = (width * state.fontSize + state.charSpace + (isSpace ? state.wordSpace : 0)) * state.scale;
  state.tm = multiply(translation(shift, 0), state.tm);
  return shift;
}

function codesOf(bytes: number[], font: FontMetrics | undefined): { code: number; isSpace: boolean }[] {
  const step = font?.isTwoByte ? 2 : 1;
  const codes: { code: number; isSpace: boolean }[] = [];
  for (let index = 0; index < bytes.length; index += step) {
    const code = step === 2 ? (bytes[index]! << 8) | (bytes[index + 1] ?? 0) : bytes[index]!;
    codes.push({ code, isSpace: step === 1 && code === 32 });
  }
  return codes;
}

/** Moves the text matrix past the shown pieces and returns the total horizontal shift. */
function show(state: Graphics, pieces: tokens.Token[]): number {
  let total = 0;
  for (const piece of pieces) {
    if (piece.kind === "number") {
      const shift = (-piece.value / 1000) * state.fontSize * state.scale;
      state.tm = multiply(translation(shift, 0), state.tm);
      total += shift;
    }
    if (piece.kind !== "string") continue;
    for (const { code, isSpace } of codesOf(piece.bytes, state.font)) total += advanceBy(state, code, isSpace);
  }
  return total;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

const number = drawOps.formatNumber;

/** A removed show operator still has to move the text position, or later text on the same line would shift left. */
function replacement(operator: string, operands: tokens.Token[], shift: number, state: Graphics): string {
  const spacing = operator === '"' ? `${number(operands[0]!.value)} Tw ${number(operands[1]!.value)} Tc ` : "";
  const nextLine = operator === "'" || operator === '"' ? "T* " : "";
  const unit = state.fontSize * state.scale;
  const adjustment = unit === 0 ? "" : `[${number((-shift * 1000) / unit)}] TJ`;
  return `${spacing}${nextLine}${adjustment}`.trim();
}

function operandCount(operator: string): number {
  return operator === '"' ? 3 : 1;
}

function pieceOf(operands: tokens.Token[]): tokens.Token[] {
  const last = operands.at(-1);
  if (!last) return [];
  return last.kind === "array" ? last.items : [last];
}

function applyOperator(state: Graphics, operator: string, operands: tokens.Token[], fonts: FontLookup): void {
  const values = operands.map((operand) => operand.value);
  const [first = 0, second = 0] = values;
  if (operator === "q") state.saved.push(state.ctm);
  else if (operator === "Q") state.ctm = state.saved.pop() ?? state.ctm;
  else if (operator === "cm" && values.length === 6) state.ctm = multiply(values as Matrix, state.ctm);
  else if (operator === "BT") {
    state.inText = true;
    state.tm = state.lineMatrix = identity;
  } else if (operator === "ET") state.inText = false;
  else if (operator === "Tm" && values.length === 6) state.tm = state.lineMatrix = values as Matrix;
  else if (operator === "Td") moveLine(state, first, second);
  else if (operator === "TD") {
    state.leading = -second;
    moveLine(state, first, second);
  } else if (operator === "T*") moveLine(state, 0, -state.leading);
  else if (operator === "Tf") {
    state.font = fonts(operands[0]?.text ?? "");
    state.fontSize = second;
  } else if (operator === "Tc") state.charSpace = first;
  else if (operator === "Tw") state.wordSpace = first;
  else if (operator === "Tz") state.scale = first / 100;
  else if (operator === "TL") state.leading = first;
  else if (operator === "Ts") state.rise = first;
}

const showOperators = new Set(["Tj", "TJ", "'", '"']);

function prepareShow(state: Graphics, operator: string, operands: tokens.Token[]): void {
  if (operator === '"' && operands.length === 3) {
    state.wordSpace = operands[0]!.value;
    state.charSpace = operands[1]!.value;
  }
  if (operator === "'" || operator === '"') moveLine(state, 0, -state.leading);
}

interface Scan {
  boxes: LineBox[];
  hits: boolean[];
  inserted: boolean[];
}

interface TextPosition {
  tm: Matrix;
  lineMatrix: Matrix;
}

/** Horizontal distance the text matrix has moved from the line matrix, in text space units. */
function offsetFromLineStart({ tm, lineMatrix }: TextPosition): number {
  const [a, b, , , e, f] = lineMatrix;
  if (Math.abs(a) >= Math.abs(b)) return a === 0 ? 0 : (tm[4] - e) / a;
  return (tm[5] - f) / b;
}

/** After the inserted text's own BT/ET, put the line matrix and text matrix back where they were. */
function restoreTextPosition(state: Graphics, position: TextPosition): string {
  const unit = state.fontSize * state.scale;
  const offset = offsetFromLineStart(position);
  const adjustment = unit === 0 || offset === 0 ? "" : ` [${number((-offset * 1000) / unit)}] TJ`;
  return `${position.lineMatrix.map(number).join(" ")} Tm${adjustment}`;
}

/** Text to emit before a removed operator so the new line sits at the old line's place in the stream. */
function insertionFor(state: Graphics, draws: drawOps.Draw[], position: TextPosition): string | null {
  const inverse = drawOps.invert(state.ctm);
  if (!inverse) return null;
  const block = drawOps.operators(draws, inverse);
  return state.inText ? ` ET${block}BT ${restoreTextPosition(state, position)} ` : block;
}

function handleShow(state: Graphics, operator: string, operands: tokens.Token[], scan: Scan): Edit | null {
  const before = { tm: state.tm, lineMatrix: state.lineMatrix };
  prepareShow(state, operator, operands);
  const origin = glyphOrigin(state);
  const shift = show(state, pieceOf(operands));
  const hit = boxAt(scan.boxes, origin.x, origin.y);
  if (hit < 0) return null;
  scan.hits[hit] = true;
  const draws = scan.boxes[hit]!.draws;
  const insertion = draws?.length && !scan.inserted[hit] ? insertionFor(state, draws, before) : null;
  if (insertion) scan.inserted[hit] = true;
  const own = operands.slice(-operandCount(operator));
  return { start: own[0]!.start, end: own.at(-1)!.end, text: (insertion ?? "") + replacement(operator, own, shift, state) };
}

function splice(source: string, edits: Edit[]): string {
  let result = "";
  let cursor = 0;
  for (const edit of edits) {
    result += source.slice(cursor, edit.start);
    result += edit.text;
    cursor = edit.end;
  }
  return result + source.slice(cursor);
}

/** Removes every text-showing operator whose glyph origin falls inside one of the boxes; the rest of the stream is copied byte for byte. */
export function strip(source: string, fonts: FontLookup, boxes: LineBox[]): StripResult {
  const state = newGraphics();
  const scan: Scan = { boxes, hits: boxes.map(() => false), inserted: boxes.map(() => false) };
  const edits: Edit[] = [];
  let operands: tokens.Token[] = [];
  let position = 0;
  for (let next = tokens.nextToken(source, position); next; next = tokens.nextToken(source, position)) {
    position = next.end;
    if (next.kind !== "operator") {
      operands.push(next);
      continue;
    }
    if (next.text === "BI") position = tokens.skipInlineImage(source, position);
    if (showOperators.has(next.text)) {
      const edit = handleShow(state, next.text, operands, scan);
      if (edit) edits.push({ ...edit, end: next.end });
    } else applyOperator(state, next.text, operands, fonts);
    operands = [];
  }
  return { content: splice(source, edits), hits: scan.hits, inserted: scan.inserted };
}
