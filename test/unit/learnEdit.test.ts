import { beforeEach, expect, test } from "bun:test";
import type { FieldDescriptor } from "../../src/types.ts";

const backing: Record<string, unknown> = {};
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (key: string) => (key in backing ? { [key]: structuredClone(backing[key]) } : {}),
      set: async (values: Record<string, unknown>) => void Object.assign(backing, structuredClone(values)),
    },
  },
};
const learning = await import("../../src/fill/learning.ts");

const field = (label: string, extra: Partial<FieldDescriptor> = {}): FieldDescriptor => ({
  id: "f", frameId: 0, kind: "text", label, name: "", placeholder: "", automationId: "", required: false, options: [], currentValue: "", section: "", ...extra,
});

beforeEach(() => {
  for (const key of Object.keys(backing)) delete backing[key];
});

test("a value the user changed after a profile fill becomes the saved answer", async () => {
  await learning.recordEdit("jobs.example.com", field("Notice period"), "profile", "30 days", "60 days");
  expect(Object.values(backing.answers as Record<string, { answer: string }>).map((entry) => entry.answer)).toEqual(["60 days"]);
});

test("a profile-filled email or login is not saved as an answer", async () => {
  await learning.recordEdit("jobs.example.com", field("Email", { kind: "email" }), "profile", "a@x.com", "site@x.com");
  expect(backing.answers).toBeUndefined();
});
