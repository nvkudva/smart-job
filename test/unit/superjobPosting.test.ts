import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from "bun:test";
import * as job from "../../src/content/job.ts";
import type { FoundJob } from "../../src/superjob/jobSources.ts";
import * as posting from "../../src/superjob/posting.ts";

const found = (source: string, url: string): FoundJob => ({ id: `${source}:1`, source, title: "Engineering Manager", company: "Acme", location: "Bengaluru", url, posted: "", salary: "", snippet: "", logoUrl: "" });

const listing = (head: string, body: string) => new DOMParser().parseFromString(`<html><head>${head}</head><body>${body}</body></html>`, "text/html");

test("LinkedIn listings get linkedin:<numeric id>, whatever the subdomain or slug", () => {
  expect(posting.idFor(found("LinkedIn", "https://in.linkedin.com/jobs/view/engineering-manager-at-acme-4484674454"))).toBe("linkedin:4484674454");
  expect(posting.idFor(found("LinkedIn", "https://www.linkedin.com/jobs/view/4484674454"))).toBe("linkedin:4484674454");
});

test("portals without a site extractor get url:<origin><path>, query string dropped", () => {
  const url = "https://www.naukri.com/job-listings-engineering-manager-acme-bengaluru-5-to-9-years-120226000123?src=jobsearchDesk&sid=1";
  expect(posting.idFor(found("Naukri", url))).toBe("url:https://www.naukri.com/job-listings-engineering-manager-acme-bengaluru-5-to-9-years-120226000123");
});

test("idFor matches the id the content extractor gives the same listing URL", () => {
  const generic = "https://www.shine.com/jobs/engineering-manager/acme/12345678?utm=1";
  const linkedin = "https://in.linkedin.com/jobs/view/engineering-manager-at-acme-4484674454?trk=x";
  const jsonLd = `<script type="application/ld+json">{"@type":"JobPosting","title":"Engineering Manager","description":"Lead a team"}</script>`;
  const topCard = '<h1 class="top-card-layout__title">Engineering Manager</h1>';
  expect(job.extract(listing(jsonLd, "<h1>Engineering Manager</h1>"), generic)?.id).toBe(posting.idFor(found("Shine", generic)));
  expect(job.extract(listing("", topCard), linkedin)?.id).toBe(posting.idFor(found("LinkedIn", linkedin)));
});
