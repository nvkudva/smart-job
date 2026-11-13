export type Matrix = [number, number, number, number, number, number];

/** One word of new text, positioned in page space. */
export interface Draw {
  /** resource name including the slash, e.g. `/Helvetica-123` */
  fontKey: string;
  size: number;
  color: [red: number, green: number, blue: number];
  x: number;
  y: number;
  /** text encoded for the font, as a hex string including the angle brackets */
  hex: string;
}

export const formatNumber = (value: number) => Number(value.toFixed(4)).toString();

export function invert([a, b, c, d, e, f]: Matrix): Matrix | null {
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-9) return null;
  return [d / determinant, -b / determinant, -c / determinant, a / determinant, (c * f - d * e) / determinant, (b * e - a * f) / determinant];
}

function drawOperators(draw: Draw): string {
  const [red, green, blue] = draw.color.map(formatNumber);
  const origin = `${formatNumber(draw.x)} ${formatNumber(draw.y)}`;
  return `${draw.fontKey} ${formatNumber(draw.size)} Tf ${red} ${green} ${blue} rg 1 0 0 1 ${origin} Tm ${draw.hex} Tj`;
}

/** Self-contained `q BT ... ET Q` that draws the words in page space whatever the stream's current matrix and text state are. */
export function operators(draws: Draw[], inverseCtm: Matrix): string {
  const undoCtm = inverseCtm.map(formatNumber).join(" ");
  return ` q ${undoCtm} cm 0 Tc 0 Tw 100 Tz 0 Tr 0 Ts BT ${draws.map(drawOperators).join(" ")} ET Q `;
}
