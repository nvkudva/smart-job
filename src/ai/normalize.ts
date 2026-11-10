/** Coercion of untrusted model output into safe values. */

export function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[,\s$₹€£]/g, ""));
  return value.trim() !== "" && Number.isFinite(parsed) ? parsed : null;
}

export function asStringList(value: unknown, max = 20): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n;]|,(?!\d)/) : [];
  return dedupe(items.map(asString).filter(Boolean)).slice(0, max);
}

export function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function asScore(value: unknown): number {
  return Math.round(clamp(asNumber(value) ?? 0, 0, 100));
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** Lowercase alphanumerics only; used to compare option texts. */
export function comparable(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Thinking models (e.g. Qwen3) spend thousands of tokens reasoning before the answer; a small budget yields empty content. */
export const tokenBudget = 8000;
