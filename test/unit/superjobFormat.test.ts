import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as skills from "../../src/ai/skills.ts";
import * as format from "../../src/superjob/descriptionFormat.ts";
import * as instahyre from "../../src/superjob/instahyre.ts";
import * as naukri from "../../src/superjob/naukri.ts";
import * as facts from "../../src/superjob/postingFacts.ts";

const fixture = (file: string) => readFileSync(join(import.meta.dir, "../fixtures/superjob", file), "utf8");

test("blocks: headings, bullets, fields and tags", () => {
  const text = "We build things. Join us.\nResponsibilities:\n• Lead the team\n- Ship code\nLocation: Bangalore\n\"Voice\", \"ASR\", \"Chat\", \"NLP\"";
  expect(format.blocks(text)).toEqual([
    { kind: "paragraph", text: "We build things. Join us." },
    { kind: "heading", text: "Responsibilities" },
    { kind: "bullets", items: ["Lead the team", "Ship code"] },
    { kind: "field", label: "Location", text: "Bangalore" },
    { kind: "tags", items: ["Voice", "ASR", "Chat", "NLP"] },
  ]);
});

test("sentences never split inside Node.js, 3.5 or after e.g.", () => {
  expect(format.sentences("Use Node.js and v3.5 daily. Know tools, e.g. Docker. Ship it.")).toEqual(["Use Node.js and v3.5 daily.", "Know tools, e.g. Docker.", "Ship it."]);
});

test("real descriptions keep all their words and get headings and bullets", () => {
  for (const text of [naukri.parseDescription(fixture("naukri-detail.html")), instahyre.parseDescription(fixture("instahyre-detail.html"))]) {
    const result = format.blocks(text);
    expect(result.some((block) => block.kind === "heading")).toBe(true);
    expect(result.some((block) => block.kind === "bullets")).toBe(true);
    const words = (value: string) => value.replace(/[•●▪◦‣∙·*\-–—:]/g, " ").split(/\s+/).filter(Boolean).length;
    const kept = result.map((block) => ("items" in block ? block.items.join(" ") : "label" in block ? `${block.label} ${block.text}` : block.text)).join(" ");
    expect(words(kept)).toBeGreaterThan(words(text) * 0.95);
  }
});

test("highlight: longer term wins, global finder leaves the shared pattern stateless", () => {
  const terms: format.Term[] = [
    { pattern: skills.finder("Java"), tone: "miss" },
    { pattern: skills.finder("JavaScript"), tone: "match" },
  ];
  const segments = format.highlight("JavaScript and Java", terms);
  expect(segments.filter((segment) => segment.tone)).toEqual([
    { text: "JavaScript", tone: "match" },
    { text: "Java", tone: "miss" },
  ]);
  expect(skills.hasSkill("Java", "Java") && skills.hasSkill("Java", "Java")).toBe(true);
});

test("posting facts: freshness, years and fit", () => {
  expect(["Just now", "7 hours ago", "2 days ago", "1 week ago", "3+ weeks ago", "1 month ago", "Posted recently"].map(facts.freshness)).toEqual(["new", "new", "new", "recent", "", "old", ""]);
  expect(facts.parseYears("12-16 Yrs")).toEqual({ min: 12, max: 16 });
  expect(facts.formatYears(facts.parseYears("5+ years")!)).toBe("5+ yrs");
  expect(facts.formatYears(facts.parseYears("Fresher")!)).toBe("Fresher");
  expect(facts.yearsFromDescription("Founded 10 years ago. Needs 5+ years of experience in Go.")).toEqual({ min: 5 });
  expect(facts.yearsFromDescription("We were founded 10 years ago.")).toBeNull();
  expect([facts.fit({ min: 5, max: 8 }, 7), facts.fit({ min: 10 }, 7), facts.fit({ min: 2, max: 3 }, 12), facts.fit({ min: 2 }, 0)]).toEqual(["fits", "under", "over", ""]);
  expect(facts.jobTypes("Bengaluru (Hybrid)")).toEqual(["Hybrid"]);
  expect(facts.jobTypes("Java Developer - Contract", "Remote teams. Strong contract negotiation.")).toEqual(["Contract"]);
  expect(facts.jobTypes("Engineer FULL_TIME", "Bangalore/Work From Office (WFO).")).toEqual(["On-site", "Full-time"]);
  expect(facts.jobTypes("Engineer", "This is a contract-to-hire role.")).toEqual(["Contract"]);
});

test("a heading with one short value becomes a field; numbers with commas are not tags", () => {
  expect(format.blocks("Num Positions\n2\nSalary Scale\nINR 5,00,000 – 16,00,000 per year\nInterview Mode\nF2F only")).toEqual([
    { kind: "field", label: "Num Positions", text: "2" },
    { kind: "field", label: "Salary Scale", text: "INR 5,00,000 – 16,00,000 per year" },
    { kind: "field", label: "Interview Mode", text: "F2F only" },
  ]);
});

test("years: open-ended Shine ranges and zero years", () => {
  expect(facts.formatYears(facts.parseYears("16 to >25 Yrs")!)).toBe("16–25 yrs");
  expect(facts.formatYears(facts.parseYears("0 Yrs")!)).toBe("Fresher");
  expect(facts.formatYears(facts.parseYears("10 - 12 Years")!)).toBe("10–12 yrs");
});

test("recent searches: newest first, no repeats, capped at 8", async () => {
  const { withQuery } = await import("../../src/superjob/recentSearches.tsx");
  let recent = [{ role: "Engineer", location: "Pune" }];
  recent = withQuery(recent, { role: "Designer", location: "" });
  recent = withQuery(recent, { role: "engineer", location: "pune" });
  expect(recent).toEqual([{ role: "engineer", location: "pune" }, { role: "Designer", location: "" }]);
  for (let index = 0; index < 10; index++) recent = withQuery(recent, { role: `Role ${index}`, location: "" });
  expect(recent).toHaveLength(8);
});
