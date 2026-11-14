import { describe, expect, test } from "bun:test";
import * as learning from "../../src/fill/learning.ts";
import type { AnswerBank, FieldDescriptor } from "../../src/types.ts";

const field = (label: string, extra: Partial<FieldDescriptor> = {}): FieldDescriptor => ({
  id: "f", frameId: 0, kind: "text", label, name: "", placeholder: "", automationId: "", required: false, options: [], currentValue: "", section: "", ...extra,
});

describe("what is worth saving", () => {
  test("ordinary questions are saved", () => expect(learning.isBankable(field("Do you have a driver's licence?"))).toBe(true));
  test("consent, single checkboxes, files and passwords never are", () => {
    expect(learning.isBankable(field("I agree to the privacy policy", { kind: "radio", options: ["Yes", "No"] }))).toBe(false);
    expect(learning.isBankable(field("Remember me", { kind: "checkbox" }))).toBe(false);
    expect(learning.isBankable(field("Resume", { kind: "file" }))).toBe(false);
    expect(learning.isBankable(field("Password", { kind: "password" }))).toBe(false);
  });
});

describe("similarAnswers", () => {
  const bank: AnswerBank = {
    "do you have experience with kubernetes": { question: "Do you have experience with Kubernetes?", answer: "Yes, 5 years", updatedAt: 1 },
    "favourite colour": { question: "Favourite colour", answer: "Blue", updatedAt: 1 },
  };
  test("offers saved answers to questions that share most words", () => {
    expect(learning.similarAnswers(bank, [field("Experience with Kubernetes in production?")])).toEqual([{ question: "Do you have experience with Kubernetes?", answer: "Yes, 5 years" }]);
  });
  test("offers nothing for unrelated questions", () => expect(learning.similarAnswers(bank, [field("Expected salary")])).toEqual([]));
});
