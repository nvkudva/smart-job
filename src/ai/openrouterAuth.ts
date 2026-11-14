import type { ProviderSettings } from "../types.ts";
import * as llm from "./llm.ts";
import * as models from "./models.ts";

// The router spreads requests over whichever free models are up, so one rate-limited upstream (Gemma on Google AI Studio) does not block the user.
const freeRouter = "openrouter/free";
// shortcut: hand-picked from the free list on 2026-11-14; a model that disappears falls back to the first free one, review when free models rotate.
const preferredFreeModels = [freeRouter, "google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free"];

export function pickFreeModel(ids: string[]): string {
  const freeIds = ids.filter((id) => id.endsWith(":free") || id === freeRouter);
  return preferredFreeModels.find((id) => freeIds.includes(id)) ?? freeIds[0] ?? "";
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge: base64Url(digest) };
}

async function askForCode(challenge: string): Promise<string | null> {
  const query = new URLSearchParams({ callback_url: chrome.identity.getRedirectURL(), code_challenge: challenge, code_challenge_method: "S256" });
  try {
    const redirect = await chrome.identity.launchWebAuthFlow({ url: `https://openrouter.ai/auth?${query}`, interactive: true });
    const code = redirect ? new URL(redirect).searchParams.get("code") : null;
    if (!code) throw new Error("OpenRouter did not send back a sign-in code.");
    return code;
  } catch (failure) {
    if (/did not approve/i.test(String(failure))) return null; // the user closed the window
    throw failure;
  }
}

async function exchangeForKey(code: string, verifier: string): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return (await response.json()).key as string;
}

/** Opens OpenRouter sign-in or sign-up and returns provider settings holding a fresh key and a free model; null when the user closes the window. */
export async function connect(): Promise<ProviderSettings | null> {
  const { verifier, challenge } = await createPkce();
  const code = await askForCode(challenge);
  if (!code) return null;
  const withKey: ProviderSettings = { ...llm.presets.OpenRouter!, apiKey: await exchangeForKey(code, verifier) };
  const model = pickFreeModel(await models.list(withKey));
  if (!model) throw new Error("OpenRouter has no free models available right now. Try again later.");
  return { ...withKey, model };
}
