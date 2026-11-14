import * as sites from "../content/jobSites.ts";
import * as messages from "../messages.ts";
import * as linkedinImport from "../profile/linkedinImport.ts";
import type { JobPosting } from "../types.ts";
import * as jobSources from "./jobSources.ts";
import type { FoundJob } from "./jobSources.ts";

const thinDescriptionChars = 300;
const extractAttempts = 4;
const extractRetryMs = 1000;

export function idFor(job: FoundJob): string {
  return job.isSearchUrl ? job.id.toLowerCase() : sites.idFromUrl(job.url);
}

async function portalDescription(job: FoundJob): Promise<string> {
  return jobSources.describe(job).catch(() => "");
}

/** The listing's own page, read by the content extractor in an inactive tab that is always closed. */
async function extractFromListing(url: string): Promise<JobPosting | null> {
  const tab = await chrome.tabs.create({ url, active: false });
  const tabId = tab.id!;
  try {
    await linkedinImport.waitForLoad(tabId, false);
    for (let attempt = 0; attempt < extractAttempts; attempt++) {
      const extracted = await messages.sendToFrame(tabId, 0, { type: "extractJob" });
      if (extracted) return extracted;
      await new Promise((resolve) => setTimeout(resolve, extractRetryMs));
    }
    return null;
  } catch {
    return null;
  } finally {
    await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

/** Never throws for a missing description: falls back to the listing's own page, then to the card snippet. */
export async function load(job: FoundJob): Promise<JobPosting> {
  let description = await portalDescription(job);
  let id = idFor(job);
  if (description.length < thinDescriptionChars && !job.isSearchUrl) {
    const original = await extractFromListing(job.url);
    if (original && original.description.length > description.length) {
      description = original.description;
      id = original.id;
    }
  }
  return {
    id,
    url: job.url,
    title: job.title,
    company: job.company,
    location: job.location,
    description: description || job.snippet,
    salaryText: job.salary,
    employmentType: "",
    source: job.source.toLowerCase(),
  };
}
