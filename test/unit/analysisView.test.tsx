import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from "bun:test";
import { render } from "preact";
import { AnalysisDetails } from "../../src/panel/job/analysisView.tsx";
import type { JobAnalysis } from "../../src/types.ts";

const base: JobAnalysis = {
  summary: "",
  mustHave: ["Python"],
  niceToHave: ["React"],
  matchScore: 72,
  keywordScore: 40,
  matchedSkills: ["Python"],
  missingSkills: [],
  verdict: "Strong match",
  salary: null,
  analyzedAt: 0,
};

function textOf(analysis: JobAnalysis): string {
  const host = document.createElement("div");
  render(<AnalysisDetails analysis={analysis} />, host);
  return host.textContent ?? "";
}

test("an analysis cached before ratings existed still renders with its stored verdict", () => {
  const text = textOf({ ...base, highlights: ["Payments domain"] });
  expect(text).toContain("Strong match");
  expect(text).toContain("Payments domain");
  expect(text).not.toContain("Keywords");
});

test("missing skills are collapsed to a preview with a +N more toggle", () => {
  const missing = ["Go", "Rust", "Kafka", "Kubernetes", "Terraform", "GraphQL", "Redis", "gRPC", "Aws", "Ci"];
  const text = textOf({ ...base, matchedSkills: [], missingSkills: missing });
  expect(text).toContain("Missing skills");
  expect(text).toContain("+4 more");
  expect(text).toContain("GraphQL");
  expect(text).not.toContain("Redis");
  expect(text).not.toContain("gRPC");
});

test("a new analysis shows the reason, evidence line and dealbreakers", () => {
  const text = textOf({ ...base, mustHaveMet: ["yes"], seniority: "match", reason: "Core stack matches", blockers: ["Needs a visa"], verdict: "Weak match - skip" });
  expect(text).toContain("Core stack matches");
  expect(text).toContain("1 of 1 must-haves · Level: fits");
  expect(text).toContain("Dealbreakers");
  expect(text).toContain("Needs a visa");
});
