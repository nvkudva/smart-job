import { beforeEach, expect, test } from "bun:test";
import * as applyPage from "../../src/panel/apply/openApplyPage.ts";
import type { JobPosting } from "../../src/types.ts";

const job = { id: "x", url: "https://portal.test/jobs/1", title: "t", company: "c" } as JobPosting;
const created: { url: string; openerTabId?: number }[] = [];
const updated: { tabId: number; url?: string }[] = [];

beforeEach(() => {
  created.length = 0;
  updated.length = 0;
  (globalThis as any).chrome = {
    runtime: { getURL: (path: string) => `chrome-extension://abc/${path}` },
    webNavigation: { getAllFrames: async () => [{ frameId: 0 }] },
    tabs: {
      create: async (options: { url: string; openerTabId?: number }) => (created.push(options), { id: 50 }),
      get: async () => ({ status: "complete" }),
      update: async (tabId: number, change: { url?: string }) => void updated.push({ tabId, ...change }),
      onUpdated: { addListener: () => {}, removeListener: () => {} },
      sendMessage: async () => ({ result: "link", href: "https://portal.test/apply/1", label: "Apply" }),
    },
  };
});

test("from a Super Job tab the listing opens in a new tab, which then follows the Apply link", async () => {
  const opened = await applyPage.open(1, "chrome-extension://abc/superjob.html", job);
  expect(created).toEqual([{ url: job.url, openerTabId: 1 }]);
  expect(updated).toEqual([{ tabId: 50, url: "https://portal.test/apply/1" }]);
  expect(opened.portalTabId).toBe(50);
});

test("from a portal tab the Apply link opens in a new tab beside it", async () => {
  const opened = await applyPage.open(7, "https://portal.test/jobs/1", job);
  expect(created).toEqual([{ url: "https://portal.test/apply/1", openerTabId: 7 }]);
  expect(updated).toEqual([]);
  expect(opened.portalTabId).toBe(50);
});
