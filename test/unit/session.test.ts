import { beforeEach, expect, test } from "bun:test";
import * as session from "../../src/fill/session.ts";
import { defaultSettings, emptyProfile } from "../../src/storage.ts";
import type { FieldDescriptor, FieldFill, FillResult } from "../../src/types.ts";

const store: Record<string, unknown> = {};
const sent: { frameId: number; request: any }[] = [];

function field(id: string, overrides: Partial<FieldDescriptor>): FieldDescriptor {
  return { id, frameId: 0, kind: "text", label: "", name: "", placeholder: "", automationId: "", required: false, options: [], currentValue: "", section: "", ...overrides };
}

const frameFields = [
  field("a", { label: "First Name", required: true }),
  field("b", { kind: "textarea", label: "Why do you want to work here?", required: true }),
  field("c", { label: "Favorite color" }),
];

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  sent.length = 0;
  Object.assign(store, { profile: { ...emptyProfile, firstName: "Priya" }, settings: { ...defaultSettings, provider: { kind: "openai", baseUrl: "http://127.0.0.1:9/v1", apiKey: "", model: "x" } } });
  (globalThis as any).chrome = {
    webNavigation: { getAllFrames: async () => [{ frameId: 0 }, { frameId: 7 }] },
    tabs: {
      sendMessage: async (_tabId: number, request: any, options: { frameId: number }) => {
        sent.push({ frameId: options.frameId, request });
        if (request.type === "scanFields") return options.frameId === 7 ? frameFields : [];
        return (request.fills as FieldFill[]).map((fill): FillResult => ({ id: fill.id, ok: true, finalValue: fill.value, error: "" }));
      },
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) => void Object.assign(store, items),
      },
    },
  };
});

test("run scans frames, fills in the right frame and reports unanswered required fields (AI failure tolerated)", async () => {
  const report = await session.run(1, null, { useAi: true, includeAccount: false });
  const fillMessage = sent.find((entry) => entry.request.type === "fillFields")!;
  expect(fillMessage.frameId).toBe(7);
  expect(fillMessage.request.fills).toEqual([{ id: "a", frameId: 7, value: "Priya", source: "profile" }]);
  expect(report.items.map((item) => item.field.id)).toEqual(["a", "b"]);
  expect(report.items[0]).toMatchObject({ fill: { source: "profile" }, result: { ok: true } });
  expect(report.filledCount).toBe(1);
  expect(report.needsReviewCount).toBe(1);
});

test("apply sends user edits and saves them to the answer bank by normalized question", async () => {
  const fills: FieldFill[] = [{ id: "b", frameId: 7, value: "Mission.", source: "user" }];
  const results = await session.apply(1, fills, true, frameFields.map((item) => ({ ...item, frameId: 7 })));
  expect(results).toHaveLength(1);
  expect((store.answers as any)["why do you want to work here"]).toMatchObject({ answer: "Mission.", question: "Why do you want to work here?" });
});
