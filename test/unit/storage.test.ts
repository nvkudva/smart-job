import { beforeEach, expect, test } from "bun:test";

const backing: Record<string, unknown> = {};
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (key: string | null) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (key === null) return structuredClone(backing);
        return key in backing ? { [key]: structuredClone(backing[key]) } : {};
      },
      set: async (values: Record<string, unknown>) => void Object.assign(backing, structuredClone(values)),
    },
  },
};
const storage = await import("../../src/storage.ts");

beforeEach(() => {
  for (const key of Object.keys(backing)) delete backing[key];
});

test("overlapping updates to one key both land", async () => {
  await Promise.all([
    storage.update("answers", (bank) => ({ ...bank, a: { question: "a", answer: "1", updatedAt: 1 } })),
    storage.update("answers", (bank) => ({ ...bank, b: { question: "b", answer: "2", updatedAt: 2 } })),
  ]);
  expect(Object.keys(backing.answers as object).sort()).toEqual(["a", "b"]);
});

test("import ignores unknown keys and rejects files without SmartJob data", async () => {
  await storage.importAll(JSON.stringify({ setupComplete: true, evil: 1 }));
  expect(backing).toEqual({ setupComplete: true });
  await expect(storage.importAll("[]")).rejects.toThrow();
  await expect(storage.importAll(JSON.stringify({ other: 1 }))).rejects.toThrow();
});

test("import rejects wrong shapes and unknown provider servers", async () => {
  await expect(storage.importAll(JSON.stringify({ jobs: [] }))).rejects.toThrow("wrong format");
  await expect(storage.importAll(JSON.stringify({ settings: "x" }))).rejects.toThrow("wrong format");
  const evil = { settings: { provider: { kind: "openai", baseUrl: "https://evil.example/v1" } } };
  await expect(storage.importAll(JSON.stringify(evil))).rejects.toThrow("unknown server");
  const local = { settings: { provider: { kind: "openai", baseUrl: "http://localhost:1234/v1" } } };
  await storage.importAll(JSON.stringify(local));
});

test("export leaves out the API key and account password", async () => {
  backing.settings = { provider: { kind: "openai", baseUrl: "http://localhost:1234/v1", apiKey: "sk-secret", model: "m" }, account: { email: "a@b.c", password: "hunter2" } };
  const exported = await storage.exportAll();
  expect(exported).not.toContain("sk-secret");
  expect(exported).not.toContain("hunter2");
  expect(exported).toContain("a@b.c");
});

test("importing an export keeps the saved API key and job-site password", async () => {
  backing.settings = { provider: { kind: "openai", baseUrl: "http://localhost:1234/v1", apiKey: "sk-keep", model: "m" }, account: { email: "a@b.c", password: "pw-keep" } };
  const exported = await storage.exportAll();
  await storage.importAll(exported);
  const settings = backing.settings as { provider: { apiKey: string }; account: { password: string } };
  expect(settings.provider.apiKey).toBe("sk-keep");
  expect(settings.account.password).toBe("pw-keep");
});
