import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from "bun:test";
import { render } from "preact";
import { AnalysisView } from "../../src/panel/job/analysisView.tsx";
import type { JobAnalysis } from "../../src/types.ts";

const base: JobAnalysis = {
  summary: "",
  mustHave: ["Python"],
  niceToHave: ["React"],
  matchScore: 72,
  keywordScore: 40,
  matchedSkills: ["Python"],
  missingSkills: [],
  strengths: ["Python depth"],
  gaps: ["No React"],
  verdict: "Strong match",
  salary: null,
  analyzedAt: 0,
};

function textOf(analysis: JobAnalysis): string {
  const host = document.createElement("div");
  render(<AnalysisView analysis={analysis} />, host);
  return host.textContent ?? "";
}

test("an analysis cached before ratings existed still renders with its stored score and verdict", () => {
  const text = textOf({ ...base, highlights: ["Payments domain"] });
  expect(text).toContain("72");
  expect(text).toContain("Strong match");
  expect(text).toContain("Payments domain");
  expect(text).not.toContain("Keywords");
});

test("a new analysis shows the reason, evidence line and dealbreakers", () => {
  const text = textOf({ ...base, mustHaveMet: ["yes"], seniority: "match", reason: "Core stack matches", blockers: ["Needs a visa"], verdict: "Weak match - skip" });
  expect(text).toContain("Core stack matches");
  expect(text).toContain("1 of 1 must-haves · level: fits");
  expect(text).toContain("Dealbreakers");
  expect(text).toContain("Needs a visa");
});
