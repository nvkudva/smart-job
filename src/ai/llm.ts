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

/** The provider refused or cut off an answer because of a size limit; the message tells the user what to do about it. */
export class TokenLimitError extends Error {}

class LlmHttpError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`LLM ${status}: ${body.slice(0, 300)}`);
  }
}

const switchAdvice = "Switch to a provider or model with a larger limit in Settings (a local model has none).";

export function isLocalServer(baseUrl: string): boolean {
  try {
    return ["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

const tooLargeWords = /request too large|context length|too many tokens|tokens per minute|prompt is too long|reduce (your|the) (message|prompt|input)|input is too long/i;

const isTooLarge = (failure: LlmHttpError) => failure.status === 413 || tooLargeWords.test(failure.body);

/** A smaller max_tokens that makes the request fit, read from the provider's own numbers; null when the input alone is too big. */
export function smallerMaxTokens(body: string, current: number): number | null {
  const minimum = 1000;
  const perMinute = /Limit (\d+), Requested (\d+)/i.exec(body);
  const context = /maximum context length is (\d+) tokens[\s\S]*?(\d+) in the messages/i.exec(body);
  const fitted = perMinute ? current - (Number(perMinute[2]) - Number(perMinute[1])) - 200 : context ? Number(context[1]) - Number(context[2]) - 100 : null;
  return fitted !== null && fitted >= minimum && fitted < current ? fitted : null;
}

function tooLargeError(model: string, failure: LlmHttpError): TokenLimitError {
  const numbers = /Limit (\d+), Requested (\d+)/i.exec(failure.body);
  const detail = numbers ? ` (limit ${numbers[1]} tokens, this needs about ${numbers[2]})` : "";
  return new TokenLimitError(`${model} cannot take a request this big${detail}. ${switchAdvice}`);
}

export const presets: Record<string, ProviderSettings> = {
  Anthropic: { kind: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "", model: "claude-opus-5-5" },
  OpenAI: { kind: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4.1-mini" },
  DeepSeek: { kind: "openai", baseUrl: "https://api.deepseek.com/v1", apiKey: "", model: "deepseek-chat" },
  Gemini: { kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: "", model: "gemini-2.5-flash" },
  Groq: { kind: "openai", baseUrl: "https://api.groq.com/openai/v1", apiKey: "", model: "llama-3.3-70b-versatile" },
  OpenRouter: { kind: "openai", baseUrl: "https://openrouter.ai/api/v1", apiKey: "", model: "openrouter/free" },
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

// shortcut: rough figures from third-party trackers (Nov 2026), providers change them without notice; recheck against each provider's rate-limit page.
export const freeLimits: Record<string, string> = {
  OpenRouter: "free, ~50 requests/day",
  Gemini: "free, limits vary",
  Groq: "free, ~30 requests/min",
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
  const isLocal = isLocalServer(settings.baseUrl);
  return {
    async chat(request) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (settings.apiKey) headers.authorization = `Bearer ${settings.apiKey}`;
      const system = request.json ? `${request.system}\n\nRespond with a single valid JSON object only. No prose, no markdown fences.` : request.system;
      const wanted = request.maxTokens ?? 2000;
      // a local server has no per-request quota, so a real task may use the whole context window; only tiny probes keep a cap
      let maxTokens: number | undefined = isLocal && wanted >= 1000 ? undefined : wanted;
      for (let attempt = 0; ; attempt++) {
        const init = {
          method: "POST",
          headers,
          signal: request.signal,
          body: JSON.stringify({
            model: settings.model,
            temperature: 0.2,
            ...(maxTokens !== undefined && { max_tokens: maxTokens }),
            ...localReasoningOption(settings.baseUrl),
            messages: [
              { role: "system", content: system },
              { role: "user", content: request.user },
            ],
          }),
        };
        try {
          const response = await fetchWithRateLimitRetry(`${settings.baseUrl.replace(/\/$/, "")}/chat/completions`, init);
          const body = await response.json();
          if (request.json && body.choices?.[0]?.finish_reason === "length") {
            throw new TokenLimitError(`${settings.model} ran out of room (${maxTokens ?? "its context"} tokens) before finishing its answer. ${switchAdvice}`);
          }
          return stripThinking(body.choices?.[0]?.message?.content ?? "");
        } catch (failure) {
          if (!(failure instanceof LlmHttpError) || !isTooLarge(failure)) throw failure;
          const smaller = maxTokens === undefined || attempt > 0 ? null : smallerMaxTokens(failure.body, maxTokens);
          if (smaller === null) throw tooLargeError(settings.model, failure);
          maxTokens = smaller;
        }
      }
    },
  };
}

const rateLimitRetries = 2;
// a longer wait means a daily or monthly quota, which waiting will not fix
const maxRateLimitWaitMs = 15000;

/** How long the provider asks us to wait, from the Retry-After header or "try again in 942.8ms" / "1m2.5s" in the body; null when it does not say. */
export function retryDelayMs(retryAfterHeader: string | null, body: string): number | null {
  const seconds = Number(retryAfterHeader);
  if (retryAfterHeader && Number.isFinite(seconds)) return seconds * 1000;
  const stated = body.match(/try again in (?:(\d+)m)?([\d.]+)(ms|s)\b/i);
  if (!stated) return null;
  const minutes = Number(stated[1] ?? 0);
  const amount = Number(stated[2]);
  return minutes * 60000 + (stated[3]!.toLowerCase() === "ms" ? amount : amount * 1000);
}

/** Per-minute limits clear within seconds, so a 429 with a short stated wait is retried quietly instead of failing the task. */
async function fetchWithRateLimitRetry(url: string, init: RequestInit & { signal?: AbortSignal }): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, init);
    if (response.ok) return response;
    const body = (await response.text()).slice(0, 1500);
    const delay = response.status === 429 ? retryDelayMs(response.headers.get("retry-after"), body) : null;
    if (delay === null || delay > maxRateLimitWaitMs || attempt >= rateLimitRetries) throw new LlmHttpError(response.status, body);
    await new Promise((resolve) => setTimeout(resolve, delay + 250));
  }
}

/** Local thinking models (Qwen 3.x) spend minutes reasoning; Ollama honours "none", LM Studio only shortens on "low". Cloud non-reasoning models reject the field, so local only. */
function localReasoningOption(baseUrl: string): { reasoning_effort?: string } {
  if (!isLocalServer(baseUrl)) return {};
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
      const message = await client.beta.messages
        .create(
          {
            model: settings.model,
            max_tokens: request.maxTokens ?? 4000,
            system,
            messages: [{ role: "user", content: request.user }],
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          },
          { signal: request.signal },
        )
        .catch((failure: unknown) => {
          if (failure instanceof Anthropic.APIError && tooLargeWords.test(failure.message)) throw new TokenLimitError(`${settings.model} cannot take a request this big. ${switchAdvice}`);
          throw failure;
        });
      if (message.stop_reason === "refusal") throw new Error("The model declined this request.");
      if (request.json && message.stop_reason === "max_tokens") throw new TokenLimitError(`${settings.model} ran out of room before finishing its answer. ${switchAdvice}`);
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
