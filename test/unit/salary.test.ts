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
  test("reads million words", () => {
    expect(salary.parseSalaryText("$1.85 million per year")).toMatchObject({ min: 1850000, max: 1850000, currency: "USD", period: "year" });
  });
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

describe("lookupLinks", () => {
  test("levels.fyi company + role page and a regional Glassdoor salary search, labelled as look-ups", () => {
    const [levels, glassdoor] = salary.lookupLinks(job);
    expect(levels!.url).toBe("https://www.levels.fyi/companies/stripe/salaries/software-engineer");
    expect(glassdoor!.url).toBe("https://www.glassdoor.co.in/Salaries/stripe-senior-engineer-salary-SRCH_KO0,22.htm");
    expect([levels, glassdoor].every((link) => link!.title.startsWith(salary.lookupPrefix))).toBe(true);
  });
  test("market-wide links for the role follow the company ones", () => {
    const urls = salary.lookupLinks(job).map((link) => link.url);
    expect(urls.slice(2)).toEqual(["https://www.levels.fyi/t/software-engineer", "https://www.glassdoor.co.in/Salaries/senior-engineer-salary-SRCH_KO0,15.htm"]);
  });
  test("company slug drops legal suffixes, and leadership titles land on the manager track", () => {
    expect(salary.levelsUrl({ ...job, company: "Stripe, Inc." })).toBe("https://www.levels.fyi/companies/stripe/salaries/software-engineer");
    expect(salary.levelsUrl({ ...job, company: "Freshworks Inc.", title: "Director, Engineering" })).toBe(
      "https://www.levels.fyi/companies/freshworks/salaries/software-engineering-manager",
    );
    expect(salary.levelsUrl({ ...job, title: "Head of Software Engineering" })).toContain("/software-engineering-manager");
    expect(salary.levelsUrl({ ...job, title: "Director, Product Management" })).toContain("/product-manager");
    expect(salary.levelsUrl({ ...job, title: "Senior Software Engineer" })).toContain("/software-engineer");
  });

  test("unknown role keeps the company page; no company falls back to the role page", () => {
    expect(salary.levelsUrl({ ...job, title: "Chief Happiness Officer" })).toBe("https://www.levels.fyi/companies/stripe/salaries");
    expect(salary.levelsUrl({ ...job, company: "" })).toBe("https://www.levels.fyi/t/software-engineer");
    expect(salary.levelsUrl({ ...job, title: "Director of Engineering" })).toContain("software-engineering-manager");
  });
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
    expect(result.sources.map((s) => s.title)).toEqual(["This job posting", expect.stringContaining("Levels.fyi"), expect.stringContaining("Glassdoor"), expect.stringContaining("Levels.fyi"), expect.stringContaining("Glassdoor")]);
    expect(result.sources[0]!.url).toBe(job.url);
  });

  test("a posted figure is kept beside web data that adds the pay split", async () => {
    const fake = new FakeLlm(['{"min": 250000, "max": 400000, "currency": "USD", "period": "year", "base": {"min": 150000, "max": 200000}, "bonus": {"min": 20000, "max": 40000}, "stock": {"min": 80000, "max": 160000}, "total": {"min": 250000, "max": 400000}, "sourceIds": [1]}']);
    const result = await salary.estimate(fake, { ...job, salaryText: "$120,000 - $150,000 a year" }, { webSearch: true }, page(html));
    expect(result).toMatchObject({ basis: "web", posted: { min: 120000, max: 150000, currency: "USD", period: "year" } });
    expect(result.components?.bonus).toEqual({ min: 20000, max: 40000 });
    expect(result.sources[0]).toEqual({ title: "This job posting", url: job.url });
  });

  test("Levels.fyi page data gives the pay split without calling the model", async () => {
    const ld = { name: "Software Engineer", estimatedSalary: [
      { name: "total", currency: "USD", percentile25: "216550", median: "284000", percentile75: "405000" },
      { name: "base", currency: "USD", percentile25: "151500", median: "193000", percentile75: "225000" },
      { name: "equity", currency: "USD", percentile25: "49900", median: "75000", percentile75: "180000" },
      { name: "bonus", currency: "USD", percentile25: null, median: "19000", percentile75: "31750" },
    ] };
    const levelsHtml = `<meta name="description" content="Software Engineer compensation in United States at Stripe ranges"><script type="application/ld+json">${JSON.stringify(ld)}</script>`;
    const fake = new FakeLlm(["{}"]);
    const usJob = { ...job, location: "San Francisco, CA", salaryText: "$120,000 - $150,000 a year" };
    const result = await salary.estimate(fake, usJob, { webSearch: true }, page(levelsHtml));
    expect(result).toMatchObject({ basis: "web", currency: "USD", posted: { min: 120000 }, components: { base: { min: 151500, max: 225000 }, bonus: { min: 19000, max: 31750 }, stock: { min: 49900, max: 180000 } } });
    expect(result.note).toContain("United States");
    expect(fake.requests).toHaveLength(0);
  });

  test("Levels.fyi US data is not used for a non-US job", async () => {
    const levelsHtml = `<script type="application/ld+json">${JSON.stringify({ name: "Senior Engineer", estimatedSalary: [{ name: "total", currency: "USD", percentile25: "216550", median: "284000", percentile75: "405000" }] })}</script>`;
    const result = await salary.estimate(new FakeLlm(["{}"]), { ...job, salaryText: "" }, { webSearch: true }, page(levelsHtml));
    expect(result.note ?? "").not.toContain("Levels.fyi: typical range");
  });

  test("web extraction with messy model output", async () => {
    const fake = new FakeLlm([
      '<think>hmm</think>Sure!\n```json\n{"min": "250,000", "max": 400000, "currency": "usd", "period": "yearly", "note": "Levels.fyi, same title", "sourceUrls": ["https://www.levels.fyi/companies/stripe/salaries"],}\n```',
    ]);
    const result = await salary.estimate(fake, job, { webSearch: true }, page(html));
    expect(result).toMatchObject({ basis: "web", min: 250000, max: 400000, currency: "USD", period: "year" });
    expect(result.sources.filter((s) => !salary.isLookup(s))).toEqual([{ title: "Stripe Salaries | Levels.fyi", url: "https://www.levels.fyi/companies/stripe/salaries" }]);
    expect(result.sources.filter(salary.isLookup)).toHaveLength(4);
    expect(fake.requests[0]!.user).toContain("Expected currency: INR");
  });

  test("sources are the cited result pages, by number or by url, never generic links", async () => {
    const byNumber = new FakeLlm(['{"min": 45, "max": 60, "currency": "INR", "period": "year", "sourceIds": [2]}']);
    const result = await salary.estimate(byNumber, job, { webSearch: true }, page(html));
    expect(result.sources.filter((s) => !salary.isLookup(s))).toEqual([{ title: "Glassdoor", url: "https://www.glassdoor.co.in/Salary/Stripe" }]);
  });

  test("uncited extraction falls back to the results that show a figure", () => {
    const results = salary.parseSearchResults(html);
    const sources = salary.citedResults({}, results);
    expect(sources.map((r) => r.url)).toEqual(["https://www.levels.fyi/companies/stripe/salaries", "https://www.glassdoor.co.in/Salary/Stripe"]);
  });

  test("search failure falls through to model estimate", async () => {
    const fake = new FakeLlm(['{"min": 4000000, "max": 6000000, "currency": "inr", "period": "year", "note": "Comparable fintech"}']);
    const result = await salary.estimate(fake, job, { webSearch: true }, failing);
    expect(result).toMatchObject({ basis: "estimate", min: 4000000, max: 6000000, currency: "INR" });
    expect(result.sources).toHaveLength(4);
    expect(result.sources.every(salary.isLookup)).toBe(true);
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

describe("pay components", () => {
  test("toRange accepts messy amounts", () => {
    expect(salary.toRange("₹45L")).toEqual({ min: 4_500_000, max: 4_500_000 });
    expect(salary.toRange("$180k")).toEqual({ min: 180_000, max: 180_000 });
    expect(salary.toRange("2.5 Cr")).toEqual({ min: 25_000_000, max: 25_000_000 });
    expect(salary.toRange("45L - 60L")).toEqual({ min: 4_500_000, max: 6_000_000 });
    expect(salary.toRange({ min: "60,000", max: 40000 })).toEqual({ min: 40_000, max: 60_000 });
    expect(salary.toRange("up to 20% of base")).toBeNull();
    expect(salary.toRange(null)).toBeNull();
  });

  test("estimate keeps the split and totals it per year", () => {
    const raw = { min: 1, max: 2, currency: "usd", base: { min: 180000, max: 220000 }, bonus: "$20k", stock: { min: 80000, max: 120000 }, total: null };
    const result = salary.normalizeEstimate(raw, "Austin");
    expect(result.components).toEqual({ base: { min: 180000, max: 220000 }, bonus: { min: 20000, max: 20000 }, stock: { min: 80000, max: 120000 }, total: { min: 280000, max: 360000 } });
    expect(result).toMatchObject({ min: 280000, max: 360000, period: "year", basis: "estimate" });
  });

  test("a stated total that covers the parts is kept; one below them is recomputed", () => {
    const parts = { base: [3000000, 4000000], stock: [1000000, 2000000] };
    const kept = salary.normalizeEstimate({ ...parts, total: { min: 4_500_000, max: 6_500_000 } }, "Pune");
    expect(kept.components!.total).toEqual({ min: 4_500_000, max: 6_500_000 });
    const fixed = salary.normalizeEstimate({ ...parts, total: { min: 1_000_000, max: 2_000_000 } }, "Pune");
    expect(fixed.components!.total).toEqual({ min: 4_000_000, max: 6_000_000 });
  });

  test("a grant is annualised over its vesting years and the note says so", () => {
    const result = salary.normalizeEstimate({ base: "₹40L", stockGrant: "₹1.2 Cr", vestingYears: "4 years", currency: "INR" }, "Bengaluru");
    expect(result.components).toMatchObject({ stock: { min: 3_000_000, max: 3_000_000 }, total: { min: 7_000_000, max: 7_000_000 } });
    expect(result.note).toContain("grant ÷ 4 years");
  });

  test("monthly figures become yearly", () => {
    const result = salary.normalizeEstimate({ period: "month", base: 400000, bonus: 50000, currency: "INR" }, "Pune");
    expect(result).toMatchObject({ period: "year", min: 5_400_000, max: 5_400_000 });
    expect(result.components!.base).toEqual({ min: 4_800_000, max: 4_800_000 });
  });

  test("partial data: a lone part or only a total stays a plain range", () => {
    const lone = salary.normalizeEstimate({ min: 3000000, max: 4000000, base: { min: 3000000, max: 4000000 }, currency: "INR" }, "Pune");
    expect(lone.components).toBeUndefined();
    expect(lone).toMatchObject({ min: 3000000, max: 4000000 });
    const totalOnly = salary.normalizeEstimate({ min: 250000, max: 400000, total: { min: 250000, max: 400000 }, base: null, bonus: null, stock: null }, "Austin");
    expect(totalOnly.components).toBeUndefined();
    expect(totalOnly).toMatchObject({ min: 250000, max: 400000 });
  });

  test("base plus stated total shows the known parts only", () => {
    const result = salary.normalizeEstimate({ base: 150000, total: 210000, currency: "USD" }, "Austin");
    expect(result.components).toEqual({ base: { min: 150000, max: 150000 }, bonus: null, stock: null, total: { min: 210000, max: 210000 } });
  });

  test("web extraction reads levels.fyi style columns", async () => {
    const reply = '{"min": 6000000, "max": 9000000, "currency": "INR", "period": "year", "base": {"min": 3500000, "max": 4500000}, "bonus": "₹5L", "stock": "₹20L-₹40L", "sourceIds": [2]}';
    const page = (async () => new Response(html, { status: 200 })) as unknown as typeof fetch;
    const result = await salary.estimate(new FakeLlm([reply]), job, { webSearch: true }, page);
    expect(result).toMatchObject({ basis: "web", min: 3_500_000 + 500_000 + 2_000_000, max: 4_500_000 + 500_000 + 4_000_000 });
    expect(result.components!.stock).toEqual({ min: 2_000_000, max: 4_000_000 });
  });

  test("hourly pay gets no split", () => {
    expect(salary.normalizeEstimate({ period: "hour", min: 40, max: 60, base: 40, bonus: 5 }, "Austin").components).toBeUndefined();
  });

  test("old estimates without components still format", () => {
    expect(salary.normalizeEstimate({ min: 4000000, max: 6000000 }, "Pune")).not.toHaveProperty("components");
  });
});

describe("posted salary with bonus or equity", () => {
  test("base only stays base only", () => {
    expect(salary.parseSalaryText("$120,000 - $150,000 a year plus bonus and equity")?.components).toBeUndefined();
  });
  test("bonus amount", () => {
    const parsed = salary.parseSalaryText("$150,000 - $180,000 a year + $20,000 annual bonus")!;
    expect(parsed).toMatchObject({ currency: "USD", min: 170000, max: 200000, period: "year" });
    expect(parsed.components).toMatchObject({ base: { min: 150000, max: 180000 }, bonus: { min: 20000, max: 20000 }, stock: null });
  });
  test("bonus percent of base", () => {
    const parsed = salary.parseSalaryText("₹30L - 40L per annum plus 10% bonus")!;
    expect(parsed.components).toMatchObject({ base: { min: 3_000_000, max: 4_000_000 }, bonus: { min: 300_000, max: 400_000 } });
    expect(parsed).toMatchObject({ min: 3_300_000, max: 4_400_000 });
  });
  test("equity grant over years", () => {
    const parsed = salary.parseSalaryText("$200,000 a year plus RSUs worth $400,000 over 4 years")!;
    expect(parsed.components).toMatchObject({ base: { min: 200000, max: 200000 }, stock: { min: 100000, max: 100000 }, total: { min: 300000, max: 300000 } });
    expect(parsed.note).toContain("grant ÷ 4 years");
  });
});
