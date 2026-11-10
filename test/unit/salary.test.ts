import { describe, expect, test } from "bun:test";
import * as salary from "../../src/ai/salary.ts";
import type { JobPosting } from "../../src/types.ts";
import { FakeLlm } from "./fakeLlm.ts";

const job: JobPosting = { id: "1", url: "https://x.test/1", title: "Senior Engineer", company: "Stripe", location: "Bengaluru, India", description: "Build payments.", salaryText: "", employmentType: "", source: "generic" };

const html = `
<div class="results">
 <div class="result results_links web-result">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.example-blog.com%2Fpay%3Fa%3D1&amp;rut=abc">Pay &amp; perks blog</a></h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">Engineers earn <b>lots</b> of money.</a>
 </div>
 <div class="result result--ad"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a><a class="result__snippet">buy</a></div>
 <div class="result">
  <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.levels.fyi%2Fcompanies%2Fstripe%2Fsalaries&amp;rut=def">Stripe Salaries | Levels.fyi</a></h2>
  <a class="result__snippet" href="x">Senior Engineer total comp is &#x24;250,000 &#8211; &#x24;400,000 per year.</a>
 </div>
 <div class="result">
  <a class="result__a" href="https://www.glassdoor.co.in/Salary/Stripe">Glassdoor</a>
  <td class="result__snippet">Avg ₹45L</td>
 </div>
</div>`;

describe("parseSalaryText", () => {
  const cases: [string, number, number, string, string][] = [
    ["$120,000 - $150,000 a year", 120000, 150000, "USD", "year"],
    ["₹25L–35L", 2500000, 3500000, "INR", "year"],
    ["USD 120k-150k", 120000, 150000, "USD", "year"],
    ["$60/hr", 60, 60, "USD", "hour"],
    ["£45,000 to £55,000 per annum", 45000, 55000, "GBP", "year"],
    ["25-35 LPA", 2500000, 3500000, "INR", "year"],
    ["€4,000 per month", 4000, 4000, "EUR", "month"],
  ];
  for (const [text, min, max, currency, period] of cases) {
    test(text, () => {
      const parsed = salary.parseSalaryText(text);
      expect(parsed).toMatchObject({ min, max, currency, period, basis: "posted" });
    });
  }
  test("no amount", () => expect(salary.parseSalaryText("Competitive salary")).toBeNull());
  test("empty", () => expect(salary.parseSalaryText("")).toBeNull());
});

describe("parseSearchResults", () => {
  const results = salary.parseSearchResults(html);
  test("extracts, decodes and skips ads", () => {
    expect(results.map((r) => r.url)).toEqual(["https://www.example-blog.com/pay?a=1", "https://www.levels.fyi/companies/stripe/salaries", "https://www.glassdoor.co.in/Salary/Stripe"]);
    expect(results[0]).toMatchObject({ title: "Pay & perks blog", snippet: "Engineers earn lots of money." });
    expect(results[1]!.snippet).toBe("Senior Engineer total comp is $250,000 – $400,000 per year.");
    expect(results[2]!.snippet).toBe("Avg ₹45L");
  });
  test("prefers salary sites", () => {
    expect(salary.pickResults(results).map((r) => r.url)[0]).toContain("levels.fyi");
    expect(salary.pickResults(results, 2)).toHaveLength(2);
  });
  test("garbage html", () => expect(salary.parseSearchResults("<html>nothing</html>")).toEqual([]));
});

describe("currencyForLocation", () => {
  test("maps", () => {
    expect(salary.currencyForLocation("Pune, Maharashtra")).toBe("INR");
    expect(salary.currencyForLocation("London, UK")).toBe("GBP");
    expect(salary.currencyForLocation("Austin, TX")).toBe("USD");
  });
});

describe("estimate", () => {
  const page = (body: string) => (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
  const failing = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;

  test("posted salary wins without calling the model", async () => {
    const fake = new FakeLlm(["{}"]);
    const result = await salary.estimate(fake, { ...job, salaryText: "$120,000 - $150,000 a year" }, { webSearch: true }, failing);
    expect(result).toMatchObject({ basis: "posted", min: 120000, max: 150000 });
    expect(fake.requests).toHaveLength(0);
    expect(result.sources.map((s) => s.title)).toContain("Levels.fyi");
  });

  test("web extraction with messy model output", async () => {
    const fake = new FakeLlm([
      '<think>hmm</think>Sure!\n```json\n{"min": "250,000", "max": 400000, "currency": "usd", "period": "yearly", "note": "Levels.fyi, same title", "sourceUrls": ["https://www.levels.fyi/companies/stripe/salaries"],}\n```',
    ]);
    const result = await salary.estimate(fake, job, { webSearch: true }, page(html));
    expect(result).toMatchObject({ basis: "web", min: 250000, max: 400000, currency: "USD", period: "year" });
    expect(result.sources[0]!.url).toContain("levels.fyi");
    expect(fake.requests[0]!.user).toContain("Expected currency: INR");
  });

  test("search failure falls through to model estimate", async () => {
    const fake = new FakeLlm(['{"min": 4000000, "max": 6000000, "currency": "inr", "period": "year", "note": "Comparable fintech"}']);
    const result = await salary.estimate(fake, job, { webSearch: true }, failing);
    expect(result).toMatchObject({ basis: "estimate", min: 4000000, max: 6000000, currency: "INR" });
    expect(result.sources).toHaveLength(2);
  });

  test("web snippets without figures fall through to estimate", async () => {
    const fake = new FakeLlm(['{"min": null, "max": null}', '{"min": 100, "max": 50, "period": "month"}']);
    const result = await salary.estimate(fake, job, { webSearch: true }, page(html));
    expect(result).toMatchObject({ basis: "estimate", min: 50, max: 100, period: "month", currency: "INR" });
  });

  test("webSearch false skips fetch", async () => {
    const fake = new FakeLlm(['{"min": 1, "max": 2}']);
    const result = await salary.estimate(fake, job, { webSearch: false }, failing);
    expect(result.basis).toBe("estimate");
  });
});

describe("parseBingResults", () => {
  test("decodes redirect urls and snippets from a real Bing page", async () => {
    const results = salary.parseBingResults(await Bun.file(`${import.meta.dir}/../fixtures/bing-results.html`).text());
    expect(results.length).toBe(3);
    for (const result of results) {
      expect(result.url).toMatch(/^https:\/\/(?!www\.bing\.com)/);
      expect(result.title.length).toBeGreaterThan(0);
    }
  });
});

describe("fixMagnitude", () => {
  test("scales lakh and k shorthand for annual pay", () => {
    expect(salary.fixMagnitude(25, "INR", "year")).toBe(2_500_000);
    expect(salary.fixMagnitude(150, "USD", "year")).toBe(150_000);
    expect(salary.fixMagnitude(60, "USD", "hour")).toBe(60);
    expect(salary.fixMagnitude(150_000, "USD", "year")).toBe(150_000);
  });
});
