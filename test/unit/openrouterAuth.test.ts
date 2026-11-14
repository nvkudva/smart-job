import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import * as openrouterAuth from "../../src/ai/openrouterAuth.ts";

test("pickFreeModel prefers a known good free model and ignores paid ones", () => {
  const ids = ["openai/gpt-4.1-mini", "a/tiny:free", "google/gemma-4-31b-it:free"];
  expect(openrouterAuth.pickFreeModel(ids)).toBe("google/gemma-4-31b-it:free");
});

test("pickFreeModel prefers the free router over any single model", () => {
  expect(openrouterAuth.pickFreeModel(["google/gemma-4-31b-it:free", "openrouter/free"])).toBe("openrouter/free");
});

test("pickFreeModel falls back to any free model, or empty when none", () => {
  expect(openrouterAuth.pickFreeModel(["openai/gpt-4.1-mini", "a/other:free"])).toBe("a/other:free");
  expect(openrouterAuth.pickFreeModel(["openai/gpt-4.1-mini"])).toBe("");
});

test("createPkce challenge is the URL-safe SHA-256 of the verifier", async () => {
  const { verifier, challenge } = await openrouterAuth.createPkce();
  expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
});
