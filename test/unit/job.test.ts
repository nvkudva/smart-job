import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as job from "../../src/content/job.ts";
import * as sites from "../../src/content/jobSites.ts";

function load(name: string, url: string) {
  const html = readFileSync(join(import.meta.dir, "../fixtures", name), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  return job.extract(doc, url);
}

const cases = [
  { file: "linkedin-job.html", url: "https://www.linkedin.com/jobs/search/?currentJobId=1001", id: "linkedin:1001", source: "linkedin", title: "Senior Frontend Engineer", company: "Acme Robotics", location: "Berlin, Germany", salary: "$120,000 - $150,000" },
  { file: "jsonld-job.html", url: "http://localhost/jsonld-job.html?utm=1#x", id: "url:http://localhost/jsonld-job.html", source: "jsonld", title: "Backend Engineer", company: "Initech", location: "Austin, TX, US", salary: "USD 120,000–150,000 / year" },
  { file: "greenhouse-job.html", url: "https://boards.greenhouse.io/hooli/jobs/55", id: "url:https://boards.greenhouse.io/hooli/jobs/55", source: "greenhouse", title: "Platform Engineer", company: "Hooli", location: "San Francisco, CA", salary: "" },
  { file: "lever-job.html", url: "https://jobs.lever.co/umbrella/abc", id: "url:https://jobs.lever.co/umbrella/abc", source: "lever", title: "Product Designer", company: "Umbrella", location: "Remote - EU", salary: "" },
  { file: "workday-job.html", url: "https://soylent.wd5.myworkdayjobs.com/en-US/careers/job/Seattle/SWE-II_1", id: "url:https://soylent.wd5.myworkdayjobs.com/en-US/careers/job/Seattle/SWE-II_1", source: "workday", title: "Software Engineer II", company: "Soylent", location: "Seattle, WA", salary: "$60/hr" },
  { file: "indeed-job.html", url: "https://www.indeed.com/viewjob?jk=abc&vjk=def123", id: "indeed:def123", source: "indeed", title: "QA Analyst", company: "Wonka Industries", location: "Chicago, IL", salary: "$85,000 - $95,000 a year" },
  { file: "generic-job.html", url: "https://pipers.example/careers/accountant", id: "url:https://pipers.example/careers/accountant", source: "generic", title: "Staff Accountant", company: "Pied Piper", location: "", salary: "" },
];

for (const c of cases) {
  test(`extracts ${c.file}`, () => {
    const result = load(c.file, c.url);
    expect(result).toMatchObject({ id: c.id, source: c.source, title: c.title, company: c.company, location: c.location, url: c.url });
    expect(result?.description.length).toBeGreaterThan(40);
    expect(result?.salaryText).toBe(c.salary);
  });
}

test("description keeps bullets on their own lines and is plain text", () => {
  const description = load("jsonld-job.html", "http://localhost/x")?.description;
  expect(description).toBe("Build APIs in Go.\n• Design services\n• Own on-call");
});

test("not-a-job page and LinkedIn pages without a job give null", () => {
  expect(load("not-a-job.html", "https://blog.example/sleep")).toBeNull();
  const feed = new DOMParser().parseFromString("<body><main><h1>Feed</h1></main></body>", "text/html");
  expect(job.extract(feed, "https://www.linkedin.com/feed/")).toBeNull();
  expect(job.extract(feed, "https://www.linkedin.com/jobs/search/")).toBeNull();
});

test("JSON-LD as top-level array and string organization", () => {
  const html = `<script type="application/ld+json">[{"@type":"Thing"},{"@type":["JobPosting"],"title":"Dev","hiringOrganization":"Foo","jobLocationType":"TELECOMMUTE","description":"x"}]</script>`;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  expect(job.extract(doc, "https://foo.example/j")).toMatchObject({ title: "Dev", company: "Foo", location: "Remote" });
});

test("salary regex", () => {
  expect(sites.findSalary("Pay: $120,000 - $150,000 per year")).toBe("$120,000 - $150,000 per year");
  expect(sites.findSalary("CTC ₹25,00,000 fixed")).toBe("₹25,00,000");
  expect(sites.findSalary("We pay 120k–150k plus equity")).toBe("120k–150k");
  expect(sites.findSalary("About $60/hr")).toBe("$60/hr");
  expect(sites.findSalary("No pay info, 5 years")).toBe("");
});
