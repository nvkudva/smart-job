import type { ProviderSettings } from "../types.ts";
import * as llm from "./llm.ts";
import * as normalize from "./normalize.ts";

export function parseIds(body: unknown): string[] {
  const entries = normalize.asRecord(body).data;
  if (!Array.isArray(entries)) return [];
  const ids = entries.map((entry) => normalize.asString(normalize.asRecord(entry).id)).filter((id) => id && !/embed/i.test(id));
  return normalize.dedupe(ids).sort();
}

/** The key only goes to a known provider or a local server, never to a half-typed URL someone else may own. */
function isTrustedHost(provider: ProviderSettings): boolean {
  if (llm.presetFor(provider)) return true;
  try {
    return ["localhost", "127.0.0.1"].includes(new URL(provider.baseUrl).hostname);
  } catch {
    return false;
  }
}

/** Model ids from an OpenAI-compatible GET /models; [] on any failure because typing a model name still works. */
export async function list(provider: ProviderSettings): Promise<string[]> {
  if (provider.kind !== "openai" || !provider.baseUrl) return [];
  const headers: Record<string, string> = provider.apiKey && isTrustedHost(provider) ? { authorization: `Bearer ${provider.apiKey}` } : {};
  try {
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/models`, { headers, signal: AbortSignal.timeout(5000) });
    return response.ok ? parseIds(await response.json()) : [];
  } catch {
    return [];
  }
}
