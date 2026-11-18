import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as foundit from "../../src/superjob/foundit.ts";
import * as instahyre from "../../src/superjob/instahyre.ts";
import type { FoundJob } from "../../src/superjob/jobSources.ts";
import * as linkedin from "../../src/superjob/linkedin.ts";
import * as naukri from "../../src/superjob/naukri.ts";
import * as shine from "../../src/superjob/shine.ts";

function fixture(file: string): string {
  return readFileSync(join(import.meta.dir, "../fixtures/superjob", file), "utf8");
}

function expectUsable(jobs: FoundJob[], sourceName: string): void {
  expect(jobs.length).toBeGreaterThan(0);
  const [first] = jobs;
  expect(first?.title).not.toBe("");
  expect(first?.company).not.toBe("");
  expect(first?.url).toStartWith("https://");
  expect(first?.id).toStartWith(`${sourceName}:`);
  expect(first?.source).toBe(sourceName);
}

function expectPlainDescription(description: string): void {
  expect(description.length).toBeGreaterThan(200);
  expect(description).not.toContain("<");
}

test("linkedin list", () => expectUsable(linkedin.parseList(fixture("linkedin-list.html")), "LinkedIn"));
test("linkedin description", () => expectPlainDescription(linkedin.parseDescription(fixture("linkedin-detail.html"))));
test("naukri list", () => expectUsable(naukri.parseList(fixture("naukri-list.html")), "Naukri"));
test("naukri description", () => expectPlainDescription(naukri.parseDescription(fixture("naukri-detail.html"))));
test("foundit list", () => expectUsable(foundit.parseList(fixture("foundit-list.html")), "Foundit"));
test("foundit description", () => expectPlainDescription(foundit.parseDescription(fixture("foundit-detail.html"))));
test("shine list", () => expectUsable(shine.parseList(fixture("shine.html")), "Shine"));
test("shine description", () => expectPlainDescription(shine.parseDescription(fixture("shine-detail.html"))));
test("instahyre list", () => expectUsable(instahyre.parseList(fixture("instahyre.json")), "Instahyre"));
test("instahyre description", () => expectPlainDescription(instahyre.parseDescription(fixture("instahyre-detail.html"))));

test("list cards carry the portal's experience wording", () => {
  expect(naukri.parseList(fixture("naukri-list.html"))[0]?.experience).toBe("12-16 Yrs");
  expect(shine.parseList(fixture("shine.html")).map((job) => job.experience)).toContain("16 to >25 Yrs");
  expect(foundit.parseList(fixture("foundit-list.html")).map((job) => job.experience)).toContain("10 - 12 Years");
});
