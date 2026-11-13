export interface Token {
  kind: "number" | "name" | "string" | "array" | "dict" | "operator";
  start: number;
  end: number;
  text: string;
  value: number;
  /** string bytes for `string`, elements for `array` */
  bytes: number[];
  items: Token[];
}

const whitespace = new Set([0, 9, 10, 12, 13, 32]);
const delimiters = new Set("()<>[]{}/%".split("").map((char) => char.charCodeAt(0)));

function token(kind: Token["kind"], start: number, end: number, source: string): Token {
  return { kind, start, end, text: source.slice(start, end), value: 0, bytes: [], items: [] };
}

const isRegular = (code: number) => !whitespace.has(code) && !delimiters.has(code);

function skipBlank(source: string, from: number): number {
  let position = from;
  while (position < source.length) {
    const code = source.charCodeAt(position);
    if (code === 0x25) {
      while (position < source.length && source.charCodeAt(position) !== 10 && source.charCodeAt(position) !== 13) position++;
    } else if (whitespace.has(code)) position++;
    else break;
  }
  return position;
}

const simpleEscapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };

function readLiteralString(source: string, start: number): Token {
  const bytes: number[] = [];
  let depth = 1;
  let position = start + 1;
  while (position < source.length && depth > 0) {
    const char = source[position]!;
    position++;
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "(" && depth > 1) bytes.push(0x28);
    else if (char === ")" && depth > 0) bytes.push(0x29);
    else if (char === "\\") {
      const next = source[position] ?? "";
      const octal = /^[0-7]{1,3}/.exec(source.slice(position, position + 3));
      if (octal) {
        bytes.push(parseInt(octal[0], 8) & 255);
        position += octal[0].length;
      } else {
        if (next in simpleEscapes) bytes.push(simpleEscapes[next]!);
        else if (next !== "\n" && next !== "\r") bytes.push(next.charCodeAt(0));
        position++;
      }
    } else if (depth > 0 && char !== "(") bytes.push(char.charCodeAt(0));
  }
  const result = token("string", start, position, source);
  result.bytes = bytes;
  return result;
}

function readHexString(source: string, start: number): Token {
  const close = source.indexOf(">", start);
  const end = close < 0 ? source.length : close + 1;
  const digits = source.slice(start + 1, end - 1).replace(/[^0-9a-fA-F]/g, "");
  const padded = digits.length % 2 ? `${digits}0` : digits;
  const result = token("string", start, end, source);
  for (let index = 0; index < padded.length; index += 2) result.bytes.push(parseInt(padded.slice(index, index + 2), 16));
  return result;
}

function readDictionary(source: string, start: number): Token {
  let position = start + 2;
  while (position < source.length) {
    const next = nextToken(source, position);
    if (!next) break;
    position = next.end;
    if (next.kind === "operator" && next.text === ">>") break;
  }
  return token("dict", start, position, source);
}

function readArray(source: string, start: number): Token {
  const result = token("array", start, start + 1, source);
  let position = start + 1;
  while (position < source.length) {
    const next = nextToken(source, position);
    if (!next) break;
    position = next.end;
    if (next.kind === "operator" && next.text === "]") break;
    result.items.push(next);
  }
  result.end = position;
  result.text = source.slice(start, position);
  return result;
}

function readWord(source: string, start: number): Token {
  let end = start;
  while (end < source.length && isRegular(source.charCodeAt(end))) end++;
  if (end === start) end = start + 1;
  const word = source.slice(start, end);
  const isNumber = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(word);
  const result = token(isNumber ? "number" : "operator", start, end, source);
  result.value = isNumber ? Number(word) : 0;
  return result;
}

export function nextToken(source: string, from: number): Token | null {
  const start = skipBlank(source, from);
  if (start >= source.length) return null;
  const char = source[start]!;
  if (char === "(") return readLiteralString(source, start);
  if (char === "[") return readArray(source, start);
  if (char === "<" && source[start + 1] === "<") return readDictionary(source, start);
  if (char === "<") return readHexString(source, start);
  if (char === ">" && source[start + 1] === ">") return token("operator", start, start + 2, source);
  if (char === "/") {
    let end = start + 1;
    while (end < source.length && isRegular(source.charCodeAt(end))) end++;
    const name = token("name", start, end, source);
    name.text = source.slice(start + 1, end);
    return name;
  }
  return readWord(source, start);
}

/** Position after an inline image's data: the first whitespace-delimited `EI` following `ID`. */
export function skipInlineImage(source: string, from: number): number {
  const dataStart = source.indexOf("ID", from);
  if (dataStart < 0) return source.length;
  const ending = /[\s]EI(?=[\s]|$)/g;
  ending.lastIndex = dataStart + 2;
  const match = ending.exec(source);
  return match ? match.index + match[0].length : source.length;
}
