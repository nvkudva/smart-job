import { expect, test } from "bun:test";
import * as summary from "../../src/superjob/summary.ts";

test("parseBullets keeps the bullets and caps them at five", () => {
  const raw = { bullets: ["Builds APIs", " Needs TypeScript ", "Remote", "Remote", "a", "b", "c"] };
  expect(summary.parseBullets(raw)).toEqual(["Builds APIs", "Needs TypeScript", "Remote", "a", "b"]);
});

test("parseBullets returns an empty list for garbage", () => {
  expect(summary.parseBullets("nonsense")).toEqual([]);
  expect(summary.parseBullets(null)).toEqual([]);
  expect(summary.parseBullets({ bullets: 42 })).toEqual([]);
});
