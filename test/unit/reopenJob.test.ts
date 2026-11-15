import { expect, test } from "bun:test";
import * as reopenJob from "../../src/panel/tracker/reopenJob.ts";
import type { TrackedJob } from "../../src/types.ts";

const entry = { job: { url: "https://jobs.acme.com/roles/42" }, portalUrl: "https://acme.wd1.myworkdayjobs.com/apply" } as TrackedJob;
const tab = (id: number, url: string) => ({ id, url }) as chrome.tabs.Tab;

test("finds the posting tab ignoring hash, query and trailing slash", () => {
  const tabs = [tab(1, "https://example.com"), tab(2, "https://jobs.acme.com/roles/42/?utm=x#top")];
  expect(reopenJob.findTab(entry, tabs)?.id).toBe(2);
});

test("finds the application portal tab", () => {
  expect(reopenJob.findTab(entry, [tab(5, "https://acme.wd1.myworkdayjobs.com/apply")])?.id).toBe(5);
});

test("returns nothing when no tab matches", () => {
  expect(reopenJob.findTab(entry, [tab(1, "https://jobs.acme.com/roles/43")])).toBeUndefined();
});
