import Anthropic from "@anthropic-ai/sdk";
import type { ProviderSettings } from "../types.ts";

export interface ChatRequest {
  system: string;
  user: string;
  /** default 2000 */
  maxTokens?: number;
  /** ask the model for a single JSON object */
  json?: boolean;
  signal?: AbortSignal;
}

export interface LlmClient {
  chat(request: ChatRequest): Promise<string>;
}

export const presets: Record<string, ProviderSettings> = {
  Anthropic: { kind: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "", model: "claude-opus-5-5" },
  OpenAI: { kind: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4.1-mini" },
  DeepSeek: { kind: "openai", baseUrl: "https://api.deepseek.com/v1", apiKey: "", model: "deepseek-chat" },
  Gemini: { kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: "", model: "gemini-2.5-flash" },
  Groq: { kind: "openai", baseUrl: "https://api.groq.com/openai/v1", apiKey: "", model: "llama-3.3-70b-versatile" },
  OpenRouter: { kind: "openai", baseUrl: "https://openrouter.ai/api/v1", apiKey: "", model: "openai/gpt-4.1-mini" },
  Ollama: { kind: "openai", baseUrl: "http://localhost:11434/v1", apiKey: "", model: "qwen2.5:7b" },
  "LM Studio": { kind: "openai", baseUrl: "http://localhost:1234/v1", apiKey: "", model: "qwen3.6-35b-a3b-splash" },
};

/** Where to create an API key, per preset; local servers need none. */
export const keyPages: Record<string, string> = {
  Anthropic: "https://console.anthropic.com/settings/keys",
  OpenAI: "https://platform.openai.com/api-keys",
  DeepSeek: "https://platform.deepseek.com/api_keys",
  Gemini: "https://aistudio.google.com/apikey",
  Groq: "https://console.groq.com/keys",
  OpenRouter: "https://openrouter.ai/settings/keys",
};

/** The preset whose server the provider points at, matched on host so a tweaked path or trailing slash still counts. */
export function presetFor(provider: ProviderSettings): string | undefined {
  const host = hostOf(provider.baseUrl);
  if (!host) return undefined;
  return Object.keys(presets).find((name) => hostOf(presets[name]!.baseUrl) === host && presets[name]!.kind === provider.kind);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function create(settings: ProviderSettings): LlmClient {
  if (settings.kind === "anthropic") return anthropicClient(settings);
  return openAiCompatibleClient(settings);
}

function openAiCompatibleClient(settings: ProviderSettings): LlmClient {
  return {
    async chat(request) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (settings.apiKey) headers.authorization = `Bearer ${settings.apiKey}`;
      const system = request.json ? `${request.system}\n\nRespond with a single valid JSON object only. No prose, no markdown fences.` : request.system;
      const response = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        signal: request.signal,
        body: JSON.stringify({
          model: settings.model,
          temperature: 0.2,
          max_tokens: request.maxTokens ?? 2000,
          ...localReasoningOption(settings.baseUrl),
          messages: [
            { role: "system", content: system },
            { role: "user", content: request.user },
          ],
        }),
      });
      if (!response.ok) throw new Error(`LLM ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const body = await response.json();
      return stripThinking(body.choices?.[0]?.message?.content ?? "");
    },
  };
}

/** Local thinking models (Qwen 3.x) spend minutes reasoning; Ollama honours "none", LM Studio only shortens on "low". Cloud non-reasoning models reject the field, so local only. */
export function localReasoningOption(baseUrl: string): { reasoning_effort?: string } {
  if (!/\/\/(localhost|127\.0\.0\.1)[:/]/.test(baseUrl)) return {};
  return { reasoning_effort: baseUrl.includes(":11434") ? "none" : "low" };
}

function anthropicClient(settings: ProviderSettings): LlmClient {
  const client = new Anthropic({
    apiKey: settings.apiKey,
    baseURL: settings.baseUrl || undefined,
    dangerouslyAllowBrowser: true,
  });
  return {
    async chat(request) {
      const system = request.json ? `${request.system}\n\nRespond with a single valid JSON object only. No prose, no markdown fences.` : request.system;
      const message = await client.beta.messages.create(
        {
          model: settings.model,
          max_tokens: request.maxTokens ?? 4000,
          system,
          messages: [{ role: "user", content: request.user }],
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal: request.signal },
      );
      if (message.stop_reason === "refusal") throw new Error("The model declined this request.");
      let text = "";
      for (const block of message.content) if (block.type === "text") text += block.text;
      return text;
    },
  };
}

function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/** Tolerant JSON extraction for small local models: strips fences/prose, finds the outermost object. */
export function parseJson<T>(text: string): T | null {
  const cleaned = stripThinking(text).replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const candidate = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(candidate) as T;
  } catch {
    try {
      // common small-model slip: trailing commas
      return JSON.parse(candidate.replace(/,\s*([}\]])/g, "$1")) as T;
    } catch {
      return null;
    }
  }
}

/** chat + parseJson with one retry that feeds back the parse failure. */
export async function chatJson<T>(client: LlmClient, request: ChatRequest): Promise<T> {
  const first = await client.chat({ ...request, json: true });
  const parsed = parseJson<T>(first);
  if (parsed) return parsed;
  const retry = await client.chat({
    ...request,
    json: true,
    user: `${request.user}\n\nYour previous reply was not valid JSON. Reply again with ONLY the JSON object.`,
  });
  const reparsed = parseJson<T>(retry);
  if (!reparsed) throw new Error("Model did not return valid JSON. Try a larger model.");
  return reparsed;
}
