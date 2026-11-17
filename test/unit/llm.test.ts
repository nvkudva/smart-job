import { afterEach, describe, expect, test } from "bun:test";
import * as llm from "../../src/ai/llm.ts";
import * as normalize from "../../src/ai/normalize.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("retryDelayMs", () => {
  test("reads the Retry-After header, milliseconds, seconds and minutes", () => {
    expect(llm.retryDelayMs("3", "")).toBe(3000);
    expect(llm.retryDelayMs(null, "Please try again in 942.857142ms. Need more tokens?")).toBeCloseTo(942.86, 1);
    expect(llm.retryDelayMs(null, "try again in 2.5s")).toBe(2500);
    expect(llm.retryDelayMs(null, "try again in 1m2.5s")).toBe(62500);
    expect(llm.retryDelayMs(null, "quota exceeded")).toBeNull();
  });
});

describe("chat on a rate limit", () => {
  const settings = { kind: "openai" as const, baseUrl: "https://x.test/v1", apiKey: "", model: "m" };
  const limited = () => new Response("try again in 10ms", { status: 429 });
  const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }));

  test("retries a short wait and then succeeds", async () => {
    const replies = [limited, ok];
    globalThis.fetch = (async () => replies.shift()!()) as unknown as typeof fetch;
    expect(await llm.create(settings).chat({ system: "s", user: "u" })).toBe("hi");
  });

  test("gives up after two retries and keeps the provider's message", async () => {
    let calls = 0;
    globalThis.fetch = (async () => (calls++, limited())) as unknown as typeof fetch;
    await expect(llm.create(settings).chat({ system: "s", user: "u" })).rejects.toThrow("LLM 429");
    expect(calls).toBe(3);
  });

  test("does not wait out a long quota", async () => {
    let calls = 0;
    globalThis.fetch = (async () => (calls++, new Response("try again in 5m", { status: 429 }))) as unknown as typeof fetch;
    await expect(llm.create(settings).chat({ system: "s", user: "u" })).rejects.toThrow("LLM 429");
    expect(calls).toBe(1);
  });
});

describe("compact", () => {
  test("squeezes spaces and blank lines but keeps paragraphs", () => {
    expect(normalize.compact("a   b \n\n\n\n c\t\td  \n")).toBe("a b\n\nc d");
  });
});

describe("chat on a size limit", () => {
  const settings = { kind: "openai" as const, baseUrl: "https://api.groq.test/v1", apiKey: "", model: "llama" };
  const tooBig = () => new Response("Request too large on tokens per minute (TPM): Limit 12000, Requested 14500, please reduce your message size", { status: 413 });
  const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] }));
  const sentMaxTokens: unknown[] = [];
  const record = (replies: (() => Response)[]) => {
    sentMaxTokens.length = 0;
    globalThis.fetch = (async (_url: string, init: { body: string }) => (sentMaxTokens.push(JSON.parse(init.body).max_tokens), replies.shift()!())) as unknown as typeof fetch;
  };

  test("retries once with a smaller max_tokens read from the provider's numbers", async () => {
    record([tooBig, ok]);
    expect(await llm.create(settings).chat({ system: "s", user: "u", maxTokens: 8000 })).toBe("hi");
    expect(sentMaxTokens).toEqual([8000, 5300]);
  });

  test("says what to do when the input alone is too big", async () => {
    record([() => new Response("Limit 6000, Requested 14500", { status: 413 })]);
    await expect(llm.create(settings).chat({ system: "s", user: "u", maxTokens: 8000 })).rejects.toBeInstanceOf(llm.TokenLimitError);
  });

  test("a cut-off JSON answer is reported as a size problem", async () => {
    record([() => new Response(JSON.stringify({ choices: [{ message: { content: "{\"a\":" }, finish_reason: "length" }] }))]);
    await expect(llm.create(settings).chat({ system: "s", user: "u", json: true })).rejects.toThrow("Switch to a provider");
  });

  test("a local server gets no max_tokens for real tasks, but keeps the cap on tiny probes", async () => {
    const local = { ...settings, baseUrl: "http://localhost:11434/v1" };
    record([ok, ok]);
    await llm.create(local).chat({ system: "s", user: "u", maxTokens: 8000 });
    await llm.create(local).chat({ system: "s", user: "u", maxTokens: 16 });
    expect(sentMaxTokens).toEqual([undefined, 16]);
  });
});
