import * as http from "./http.ts";
import * as jobPosting from "./jobPosting.ts";
import type { FoundJob, SearchQuery, Source } from "./jobSources.ts";

const name = "Instahyre";
const searchUrl = "https://www.instahyre.com/api/v1/job_search";
const maxJobs = 25;
const pageSize = 15;
const cityNames: Record<string, string> = { bengaluru: "Bangalore", gurugram: "Gurgaon" };

interface Posting {
  id: number;
  title: string;
  locations: string;
  public_url: string;
  keywords: string[];
  employer: { company_name: string; profile_image_src: string };
}

function cityOf(location: string): string {
  const city = location.split(",")[0]!.trim();
  return cityNames[city.toLowerCase()] ?? city;
}

function toJob(posting: Posting): FoundJob {
  return {
    id: `${name}:${posting.id}`,
    source: name,
    title: posting.title,
    company: posting.employer.company_name,
    location: posting.locations.split(",").join(", "),
    url: posting.public_url,
    posted: "",
    salary: "",
    snippet: posting.keywords.slice(0, 8).join(", "),
    logoUrl: posting.employer.profile_image_src,
  };
}

export function parseList(raw: string): FoundJob[] {
  const data = JSON.parse(raw) as { objects?: Posting[] };
  return (data.objects ?? []).slice(0, maxJobs).map(toJob);
}

async function search(query: SearchQuery, page: number): Promise<FoundJob[]> {
  const city = cityOf(query.location);
  const place = city ? `&jobLocations=${encodeURIComponent(city)}` : "";
  const url = `${searchUrl}?company_size=0&job_type=0${place}&skills=${encodeURIComponent(query.role)}&offset=${page * pageSize}`;
  return parseList(await http.text(name, url));
}

export const parseDescription = jobPosting.description;

async function describe(job: FoundJob): Promise<string> {
  const description = parseDescription(await http.text(name, job.url));
  return description || job.snippet;
}

export const source: Source = { name, countries: ["india"], search, describe };
