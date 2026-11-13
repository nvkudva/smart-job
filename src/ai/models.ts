import type { ProviderSettings } from "../types.ts";
import * as normalize from "./normalize.ts";

export function parseIds(body: unknown): string[] {
  const entries = normalize.asRecord(body).data;
  if (!Array.isArray(entries)) return [];
  const ids = entries.map((entry) => normalize.asString(normalize.asRecord(entry).id)).filter((id) => id && !/embed/i.test(id));
  return normalize.dedupe(ids).sort();
}

/** Model ids from an OpenAI-compatible GET /models; [] on any failure because typing a model name still works. */
export async function list(provider: ProviderSettings): Promise<string[]> {
  if (provider.kind !== "openai" || !provider.baseUrl) return [];
  const headers: Record<string, string> = provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {};
  try {
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/models`, { headers, signal: AbortSignal.timeout(5000) });
    return response.ok ? parseIds(await response.json()) : [];
  } catch {
    return [];
  }
}
