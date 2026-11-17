import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from "bun:test";
import type { JobAnalysis, TrackedJob } from "../../src/types.ts";
import { scoreTone } from "../../src/panel/job/analysisView.tsx";
import { filterByPortals, scoreFor } from "../../src/superjob/jobList.tsx";
import type { FoundJob } from "../../src/superjob/jobSources.ts";

const found = (id: string, source: string, snippet = ""): FoundJob => ({ id, source, title: "Engineering Manager", company: "Acme", location: "", url: "", posted: "", salary: "", snippet, logoUrl: "" });
const analysis = (matchScore: number) => ({ matchScore }) as JobAnalysis;
const tracked = (matchScore: number | null) => ({ analysis: matchScore === null ? null : analysis(matchScore) }) as TrackedJob;

test("score bands match the side panel: 70 and up good, 45 and up mid", () => {
  expect([scoreTone(70), scoreTone(69), scoreTone(45), scoreTone(44)]).toEqual(["good", "mid", "mid", "bad"]);
});

test("a stored analysis wins over the tracked job's copy, and no analysis means no badge", () => {
  const stored = { analyses: { a: analysis(81.4) }, tracked: { a: tracked(50), b: tracked(62), c: tracked(null) } };
  expect(scoreFor("a", stored)).toBe(81);
  expect(scoreFor("b", stored)).toBe(62);
  expect(scoreFor("c", stored)).toBeNull();
  expect(scoreFor("d", stored)).toBeNull();
});

test("hiding a portal drops only its jobs", () => {
  const jobs = [found("LinkedIn:1", "LinkedIn"), found("Naukri:1", "Naukri"), found("Naukri:2", "Naukri")];
  expect(filterByPortals(jobs, new Set(["Naukri"])).map((job) => job.id)).toEqual(["LinkedIn:1"]);
  expect(filterByPortals(jobs, new Set())).toHaveLength(3);
});
