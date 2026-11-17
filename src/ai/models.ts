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
  return !!llm.presetFor(provider) || llm.isLocalServer(provider.baseUrl);
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

/** LM Studio's native listing marks the model it has loaded; embedding models never count. */
export function parseLmStudioLoaded(body: unknown): string | undefined {
  const entries = normalize.asRecord(body).data;
  if (!Array.isArray(entries)) return undefined;
  const loaded = entries.map(normalize.asRecord).find((entry) => entry.state === "loaded" && entry.type !== "embeddings");
  return loaded ? normalize.asString(loaded.id) || undefined : undefined;
}

/** Ollama's /api/ps lists the models currently in memory. */
export function parseOllamaRunning(body: unknown): string | undefined {
  const entries = normalize.asRecord(body).models;
  if (!Array.isArray(entries)) return undefined;
  const running = entries.map(normalize.asRecord).find((entry) => !/embed/i.test(normalize.asString(entry.name)));
  return running ? normalize.asString(running.name) || undefined : undefined;
}

async function getJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}

/** The model a local server (LM Studio, Ollama) has loaded right now; undefined for hosted providers, which have no such thing. */
export async function active(provider: ProviderSettings): Promise<string | undefined> {
  const hostedPreset = llm.presetFor(provider);
  const isLocalPreset = hostedPreset === "LM Studio" || hostedPreset === "Ollama";
  if (provider.kind !== "openai" || !provider.baseUrl || (hostedPreset && !isLocalPreset)) return undefined;
  try {
    const origin = new URL(provider.baseUrl).origin;
    const [lmStudio, ollama] = await Promise.all([getJson(`${origin}/api/v0/models`), getJson(`${origin}/api/ps`)]);
    return parseLmStudioLoaded(lmStudio) ?? parseOllamaRunning(ollama);
  } catch {
    return undefined;
  }
}
