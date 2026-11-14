import { expect, test } from "bun:test";
import * as format from "../../src/panel/shared/format.ts";

test("same amount groups by locale; currency stays the data's", () => {
  expect(format.money(1200000, "INR", "en-IN")).toBe("₹12,00,000");
  expect(format.money(1200000, "INR", "en-US")).toBe("₹1,200,000");
  expect(format.money(1300000, "INR")).toBe("₹13,00,000");
  expect(format.money(1200000, "INR", "de-DE")).toBe("1.200.000 ₹");
});

test("non-ISO or empty currency falls back to a plain number", () => {
  expect(format.money(5000, "Rs", "en-US")).toBe("RS 5,000");
  expect(format.money(5000, "", "en-US")).toBe("5,000");
  expect(format.moneyRange(10, 20, "USD", "en-US")).toBe("$10 – $20");
});

test("salary digits group the Indian way for an India profile and keep other text", () => {
  const india = format.localeForCountry("India");
  expect(format.groupDigits("1200000", india)).toBe("12,00,000");
  expect(format.groupDigits("12,00,000", india)).toBe("12,00,000");
  expect(format.groupDigits("1200000", format.localeForCountry("USA") ?? "en-US")).toBe("1,200,000");
  expect(format.groupDigits("12 LPA", india)).toBe("12 LPA");
});
