import { describe, expect, test } from "bun:test";
import * as office from "../../src/ai/office.ts";
import type { JobPosting } from "../../src/types.ts";
import { FakeLlm } from "./fakeLlm.ts";

const job: JobPosting = { id: "1", url: "https://x.test/1", title: "Director, Engineering", company: "Acme", location: "Bengaluru, Karnataka, India", description: "Build things.", salaryText: "", employmentType: "", source: "generic" };
const results = [
  { title: "Acme offices", url: "https://acme.test/offices", snippet: "Acme, Manyata Tech Park, Bengaluru 560045" },
  { title: "Acme contact", url: "https://acme.test/contact", snippet: "Acme, Prestige Towers, Bangalore 560001" },
];

describe("cityOf", () => {
  test("takes the city from the location, stripping work-mode prefixes", () => {
    expect(office.cityOf("Bengaluru, Karnataka, India")).toBe("Bengaluru");
    expect(office.cityOf("Hybrid - Bangalore, India")).toBe("Bangalore");
    expect(office.cityOf("Remote - Pune, Maharashtra")).toBe("Pune");
    expect(office.cityOf("Remote, India")).toBe("");
    expect(office.cityOf("")).toBe("");
  });
});

describe("normalizeOffice", () => {
  test("keeps both addresses in the city, drops duplicates, keeps cited sources", () => {
    const result = office.normalizeOffice(
      { addresses: ["Manyata Tech Park, Bengaluru 560045", "Prestige Towers, Bangalore 560001", "manyata tech park, bengaluru 560045"], match: "city", sourceIds: [1, 2, 9] },
      results,
      "Bengaluru",
    );
    expect(result.addresses).toEqual(["Manyata Tech Park, Bengaluru 560045", "Prestige Towers, Bangalore 560001"]);
    expect(result.match).toBe("city");
    expect(result.sources).toHaveLength(2);
  });

  test("likely fallback and empty result", () => {
    expect(office.normalizeOffice({ addresses: ["1 HQ Way, Hyderabad"], match: "likely", sourceIds: [1] }, results, "Bengaluru").match).toBe("likely");
    expect(office.normalizeOffice({ addresses: [], match: "city", sourceIds: [] }, results, "Bengaluru")).toEqual({ addresses: [], match: "none", city: "Bengaluru", sources: [] });
  });
});

describe("rankResults", () => {
  test("drops unrelated engine junk and ranks address-bearing company + city results first", () => {
    const junk = [
      { title: "WhatsApp Web", url: "https://web.whatsapp.com/", snippet: "Log in to WhatsApp Web" },
      { title: "EPFO office news", url: "https://example.com/epfo", snippet: "Provident Fund office updates" },
    ];
    const ranked = office.rankResults([...junk, ...results], "Acme", "Bengaluru");
    expect(ranked.map((result) => result.url)).toEqual(["https://acme.test/offices", "https://acme.test/contact"]);
  });
});

describe("parseBraveResults", () => {
  test("reads title, url and snippet from Brave result markup", () => {
    const html = `<a href="https://example.com/google-offices" target="_self" class="l1"><div class="site-name">Example</div>
      <div class="title search-snippet-title line-clamp-1" title="Google Offices in India">Google Offices in India</div></a>
      <div class="generic-snippet"><div class="content">Address: No. 3, RMZ Infinity, Old Madras Road, Bengaluru, Karnataka 560038</div></div>`;
    const [result] = office.parseBraveResults(html);
    expect(result?.title).toBe("Google Offices in India");
    expect(result?.url).toBe("https://example.com/google-offices");
    expect(result?.snippet).toContain("RMZ Infinity");
  });
});

describe("officeFromOsm", () => {
  test("keeps every company place in the city, cleaned of admin repeats, with OSM sources", () => {
    const places = [
      { display_name: "Google Ananta, Service Road, Mahadevapura, Bengaluru East City Corporation, Bengaluru, Bengaluru Urban, Karnataka, 560093, India", name: "Google Ananta", osm_type: "way", osm_id: 123 },
      { display_name: "Google, Swamy Vivekananda Road, Benniganahalli, Bengaluru, Karnataka, 560016, India", name: "Google", osm_type: "node", osm_id: 456 },
      { display_name: "Google Store, MG Road, Chennai, Tamil Nadu, 600001, India", name: "Google Store", osm_type: "node", osm_id: 789 },
      { display_name: "Microsoft, Lavelle Road, Bengaluru, Karnataka, 560001, India", name: "Microsoft", osm_type: "node", osm_id: 999 },
    ];
    const result = office.officeFromOsm(places, "Google", "Bengaluru");
    expect(result?.match).toBe("city");
    expect(result?.addresses).toEqual([
      "Google Ananta, Service Road, Mahadevapura, Bengaluru, Karnataka, 560093, India",
      "Google, Swamy Vivekananda Road, Benniganahalli, Bengaluru, Karnataka, 560016, India",
    ]);
    expect(result?.sources.map((source) => source.url)).toEqual(["https://www.openstreetmap.org/way/123", "https://www.openstreetmap.org/node/456"]);
    expect(office.officeFromOsm(places, "Google", "Pune")).toBeNull();
  });
});

describe("find", () => {
  test("makes no LLM request when the web search finds nothing, so no address is guessed", async () => {
    const fake = new FakeLlm(["{}"]);
    const notFound = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    const result = await office.find(fake, job, { webSearch: true }, notFound);
    expect(result).toEqual({ addresses: [], match: "none", city: "Bengaluru", sources: [] });
    expect(fake.requests).toHaveLength(0);
  });

  test("makes no request when web search is off", async () => {
    const fake = new FakeLlm(["{}"]);
    const result = await office.find(fake, job, { webSearch: false });
    expect(result.match).toBe("none");
    expect(fake.requests).toHaveLength(0);
  });
});
