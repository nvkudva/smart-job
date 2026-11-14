import * as foundit from "./foundit.ts";
import * as instahyre from "./instahyre.ts";
import * as linkedin from "./linkedin.ts";
import * as naukri from "./naukri.ts";
import * as shine from "./shine.ts";

export interface SearchQuery {
  role: string;
  location: string;
}

export interface FoundJob {
  /** unique across sources: "<source name>:<portal job id>" */
  id: string;
  /** display name of the portal, e.g. "LinkedIn" */
  source: string;
  title: string;
  company: string;
  location: string;
  /** the original listing on the portal */
  url: string;
  /** as the portal words it ("3 days ago"), "" when unknown */
  posted: string;
  salary: string;
  /** short text from the result card, "" when the portal shows none */
  snippet: string;
  logoUrl: string;
}

export interface Source {
  name: string;
  /** lower-case country names this portal serves; empty means every country */
  countries: string[];
  search(query: SearchQuery): Promise<FoundJob[]>;
  /** full description text of one listing; rejects when the portal blocks the read */
  describe(job: FoundJob): Promise<string>;
}

const sources: Source[] = [linkedin.source, naukri.source, foundit.source, shine.source, instahyre.source];

export function forCountry(country: string): Source[] {
  const typed = country.trim().toLowerCase();
  const wanted = /^(in|ind|bharat)$/.test(typed) ? "india" : typed;
  return sources.filter((source) => source.countries.length === 0 || source.countries.includes(wanted));
}

export function describe(job: FoundJob): Promise<string> {
  const source = sources.find((candidate) => candidate.name === job.source);
  return source ? source.describe(job) : Promise.reject(new Error(`Unknown job source ${job.source}`));
}
