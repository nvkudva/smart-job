import { describe, expect, test } from "bun:test";
import * as perks from "../../src/ai/perks.ts";
import type { JobPosting } from "../../src/types.ts";
import { FakeLlm } from "./fakeLlm.ts";

const job: JobPosting = { id: "1", url: "https://x.test/1", title: "Engineer", company: "Acme", location: "Pune", description: "We offer hybrid work and health insurance.", salaryText: "", employmentType: "", source: "generic" };
const results = [{ title: "Acme benefits", url: "https://acme.test/careers", snippet: "30 days paid leave" }];

describe("normalizePerks", () => {
  test("groups into known categories, drops duplicates and keeps cited sources", () => {
    const result = perks.normalizePerks({ perks: [{ category: "leave", text: "30 days paid leave" }, { category: "Snacks", text: "Free lunch" }, "free lunch", { text: "" }], sourceIds: [1, 9] }, results);
    expect(result.items).toEqual([{ category: "Leave", text: "30 days paid leave" }, { category: "Other", text: "Free lunch" }]);
    expect(result.sources).toEqual([{ title: "Acme benefits", url: "https://acme.test/careers" }]);
  });
});

describe("find", () => {
  test("reads the posting alone when web search is off", async () => {
    const fake = new FakeLlm(['{"perks": [{"category": "Work mode", "text": "Hybrid"}], "sourceIds": []}']);
    const result = await perks.find(fake, job, { webSearch: false });
    expect(result.items).toEqual([{ category: "Work mode", text: "Hybrid" }]);
    expect(result.sources).toEqual([]);
  });
});
