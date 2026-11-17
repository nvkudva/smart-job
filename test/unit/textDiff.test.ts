import { expect, test } from "bun:test";
import * as textDiff from "../../src/resume/textDiff.ts";

test("marks removed and added words and keeps the shared ones", () => {
  const pieces = textDiff.wordDiff("Led a team of five engineers", "Led a platform team of five");
  expect(pieces.filter((piece) => piece.kind === "added").map((piece) => piece.text)).toEqual(["platform"]);
  expect(pieces.filter((piece) => piece.kind === "removed").map((piece) => piece.text)).toEqual(["engineers"]);
  expect(pieces.filter((piece) => piece.kind !== "removed").map((piece) => piece.text).join(" ")).toBe("Led a platform team of five");
});

test("identical text is one unchanged piece", () => {
  expect(textDiff.wordDiff("a b c", "a b c")).toEqual([{ text: "a b c", kind: "same" }]);
});
