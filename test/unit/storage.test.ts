import { beforeEach, expect, test } from "bun:test";

const backing: Record<string, unknown> = {};
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (key: string) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
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
