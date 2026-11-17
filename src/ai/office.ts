import type { CompanyOffice, JobPosting } from "../types.ts";
import * as llm from "./llm.ts";
import * as normalize from "./normalize.ts";
import * as salary from "./salary.ts";
import type { SearchResult } from "./salary.ts";

const CITY_ALIASES: Record<string, string> = { bengaluru: "Bangalore", bangalore: "Bengaluru", bombay: "Mumbai", mumbai: "Bombay", madras: "Chennai", chennai: "Madras", calcutta: "Kolkata", kolkata: "Calcutta" };

/** "Hybrid - Bengaluru East, Karnataka, India" -> "Bengaluru"; "" when the location names no city (e.g. "Remote, India"). */
export function cityOf(location: string): string {
  const first = (location.split(",")[0] ?? "")
    .replace(/\b(remote|hybrid|onsite|on site|work from home|wfh)\b/gi, " ")
    .replace(/^[\s\-–—·|]+|[\s\-–—·|]+$/g, "")
    .replace(/(\s+(east|west|north|south|central|urban|rural))+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return first.length > 1 ? first : "";
}

const COMPANY_SUFFIX = /^(inc|llc|llp|ltd|limited|corp|corporation|co|company|pvt|private|plc|gmbh)$/i;

/** Company name as maps know it: "Freshworks Inc." -> "Freshworks". */
export function companyQueryName(company: string): string {
  const words = company.replace(/\([^)]*\)/g, " ").replace(/[,.'’]+/g, " ").trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && COMPANY_SUFFIX.test(words.at(-1)!)) words.pop();
  return words.join(" ");
}

function queriesFor(company: string, city: string): string[] {
  const alias = CITY_ALIASES[city.toLowerCase()];
  const places = [city, alias].filter(Boolean);
  const queries = places.map((place) => `${company} office ${place} address`);
  queries.push(`${company} offices in India address`, `${company} headquarters address`);
  return [...new Set(queries)];
}

function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Brave results: an anchor wrapping a `search-snippet-title` div, followed by a `generic-snippet` body. */
export function parseBraveResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const match of html.matchAll(/class="[^"]*search-snippet-title[^"]*"[^>]*title="([^"]+)"/g)) {
    const at = match.index;
    const before = html.slice(Math.max(0, at - 3000), at);
    const url = [...before.matchAll(/href="(https?:\/\/[^"]+)"/g)].at(-1)?.[1];
    if (!url || url.includes("search.brave.com")) continue;
    const after = html.slice(at, at + 3000);
    const snippet = after.match(/generic-snippet[\s\S]{0,2000}?>([\s\S]{0,1400})/)?.[1] ?? "";
    results.push({ title: plain(match[1]!), url: plain(url), snippet: plain(snippet).slice(0, 500) });
  }
  return results;
}

async function searchQuery(query: string, fetchPage: typeof fetch): Promise<SearchResult[]> {
  // Brave first because its snippets carry the address itself; Bing often answers office queries with unrelated pages and DDG challenges some networks. The next engine is asked only when one comes back empty.
  const engines: [string, (html: string) => SearchResult[]][] = [
    [`https://search.brave.com/search?q=${encodeURIComponent(query)}`, parseBraveResults],
    [`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, salary.parseSearchResults],
    [`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`, salary.parseBingResults],
  ];
  for (const [url, parse] of engines) {
    const results = await salary.fetchResults(url, parse, fetchPage);
    if (results.length) return results;
  }
  return [];
}

const ADDRESS_SIGNAL = /address|located|office|campus|\b\d{6}\b|road|street|nagar|layout|park|tower|plaza|floor|block|sector|phase/i;

/** Keep only results that plausibly state this company's address in this city; rank those with a PIN / street words first. */
export function rankResults(results: SearchResult[], company: string, city: string): SearchResult[] {
  const companyWords = company.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  const places = [city.toLowerCase(), CITY_ALIASES[city.toLowerCase()]?.toLowerCase()].filter(Boolean) as string[];
  const scored = results.map((result) => {
    const text = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
    let score = 0;
    if (companyWords.length && companyWords.every((word) => text.includes(word))) score += 3;
    else if (companyWords.some((word) => text.includes(word))) score += 1;
    if (places.some((place) => text.includes(place))) score += 3;
    if (/\b\d{6}\b/.test(text)) score += 2;
    if (ADDRESS_SIGNAL.test(text)) score += 1;
    return { result, score };
  });
  return scored
    .filter(({ score }) => score >= 4)
    .sort((a, b) => b.score - a.score)
    .map(({ result }) => result);
}

export async function searchWeb(company: string, city: string, fetchPage: typeof fetch = fetch): Promise<SearchResult[]> {
  const seen = new Set<string>();
  const unique: SearchResult[] = [];
  // sequential with early stop: parallel bursts get the engines to rate-limit the panel
  for (const query of queriesFor(company, city)) {
    for (const result of await searchQuery(query, fetchPage)) {
      if (!seen.has(result.url) && !!seen.add(result.url)) unique.push(result);
    }
    const ranked = rankResults(unique, company, city);
    if (ranked.length >= 5) return ranked.slice(0, 10);
  }
  return rankResults(unique, company, city).slice(0, 10);
}

// ---------- OpenStreetMap (structured addresses, no scraping) ----------

interface OsmPlace {
  display_name?: string;
  name?: string;
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
}

const ADMIN_SEGMENT = /city corporation|\burban\b|\brural\b|^(bangalore|bengaluru|bombay|mumbai|madras|chennai|calcutta|kolkata) (east|west|north|south|central)$/i;

/** OSM display names repeat the city through every admin level; keep the street-level parts, the city, state and PIN. */
function cleanOsmAddress(displayName: string): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const segment of displayName.split(",").map((part) => part.trim()).filter(Boolean)) {
    const key = segment.toLowerCase();
    if (ADMIN_SEGMENT.test(segment) || seen.has(key)) continue;
    seen.add(key);
    kept.push(segment);
    if (kept.length >= 7) break;
  }
  return kept.join(", ");
}

/** Company places OSM knows in the job's city, as a finished office result; null when OSM has none there. */
export function officeFromOsm(places: unknown, company: string, city: string): CompanyOffice | null {
  if (!Array.isArray(places)) return null;
  const companyWord = company.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] ?? "";
  const placesText = [city.toLowerCase(), CITY_ALIASES[city.toLowerCase()]?.toLowerCase()].filter(Boolean) as string[];
  const seen = new Set<string>();
  const addresses: CompanyOffice["addresses"] = [];
  const sources: CompanyOffice["sources"] = [];
  for (const place of places as OsmPlace[]) {
    const display = (place.display_name ?? "").toLowerCase();
    if (!companyWord || !display.includes(companyWord) || !placesText.some((text) => display.includes(text))) continue;
    const address = cleanOsmAddress(place.display_name ?? "");
    if (address.length < 12 || seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    const lat = Number(place.lat);
    const lon = Number(place.lon);
    addresses.push({ address, ...(Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : {}) });
    if (place.osm_type && place.osm_id) sources.push({ title: place.name || address, url: `https://www.openstreetmap.org/${place.osm_type}/${place.osm_id}` });
    if (addresses.length >= 6) break;
  }
  return addresses.length ? { addresses, match: "city", city, sources: sources.slice(0, 4) } : null;
}

async function searchOsm(company: string, city: string, fetchPage: typeof fetch): Promise<CompanyOffice | null> {
  const name = companyQueryName(company);
  const alias = CITY_ALIASES[city.toLowerCase()];
  const queries = [`${name} ${city}`, ...(alias ? [`${name} ${alias}`] : []), `${name} office ${city}`, name];
  const seen = new Set<string>();
  const places: unknown[] = [];
  // several spellings, merged: OSM may know the office under the alias city, the short company name, or with no city in the name at all
  for (const query of queries) {
    try {
      const response = await fetchPage(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=8`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) continue;
      for (const place of (await response.json()) as OsmPlace[]) {
        const key = `${place.osm_type}/${place.osm_id}`;
        if (!seen.has(key) && !!seen.add(key)) places.push(place);
      }
    } catch {
      continue;
    }
    const found = officeFromOsm(places, name, city);
    if (found) return found;
  }
  return null;
}

const officeSystem = `Find the company's office for the job's city, from the search snippets. Reply with JSON only:
{"addresses": ["full address as stated"], "match": "city" | "likely", "sourceIds": [2]}
- List EVERY distinct office address in the job's city that the snippets state; a city can have two offices — include both.
- Copy addresses exactly as stated (building, street, area, city, PIN/ZIP when given). Never invent, complete or guess an address.
- No office in the job's city: give the most probable office instead (the headquarters, or the nearest office the snippets state) with "match": "likely" and only that address.
- Nothing stated anywhere: {"addresses": [], "match": "likely", "sourceIds": []}.
- sourceIds are the [numbers] of the snippets you used.`;

function buildPrompt(job: JobPosting, city: string, results: SearchResult[]): string {
  const snippets = results.map((result, index) => `[${index + 1}] ${result.title}\n${result.url}\n${normalize.truncate(result.snippet, 400)}`);
  return `Company: ${job.company}\nJob: ${job.title}\nJob city: ${city || "unknown (from location: " + (job.location || "not stated") + ")"}\n\nSearch results:\n${snippets.join("\n\n")}`;
}

export function normalizeOffice(raw: unknown, results: SearchResult[], city: string): CompanyOffice {
  const data = normalize.asRecord(raw);
  const list = Array.isArray(data.addresses) ? data.addresses : [];
  const seen = new Set<string>();
  const addresses = list
    .map((entry) => normalize.asString(typeof entry === "string" ? entry : normalize.asRecord(entry).address).replace(/\s+/g, " ").trim())
    .filter((address) => address.length > 8 && !seen.has(address.toLowerCase()) && !!seen.add(address.toLowerCase()))
    .slice(0, 6)
    .map((address) => ({ address }));
  const ids = (Array.isArray(data.sourceIds) ? data.sourceIds : []).map((id) => normalize.asNumber(id));
  const sources = results.filter((_, index) => ids.includes(index + 1)).slice(0, 4).map(({ title, url }) => ({ title, url }));
  if (!addresses.length) return { addresses: [], match: "none", city, sources: [] };
  return { addresses, match: data.match === "likely" ? "likely" : "city", city, sources };
}

export interface Coords {
  lat: number;
  lon: number;
}

export function haversineKm(a: Coords, b: Coords): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const peakSpeedKmh = 15;
const peakOverheadMin = 8;

/** Rough city peak-hour drive time: straight-line distance at peak traffic speed, plus getting in and out. */
export function peakTimeText(distanceKm: number): string {
  const minutes = Math.max(10, Math.round(((distanceKm / peakSpeedKmh) * 60 + peakOverheadMin) / 5) * 5);
  if (minutes < 60) return `≈ ${minutes} min at peak`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `≈ ${hours} h ${rest} min at peak` : `≈ ${hours} h at peak`;
}

/** Coordinates for a free-text place (the user's own address), for saving as the distance starting point. */
export function geocodeAddress(address: string, fetchPage: typeof fetch = fetch): Promise<Coords | undefined> {
  return geocode(address, fetchPage);
}

export interface PlaceSuggestion {
  /** first parts of the OSM display name, e.g. "Indiranagar, Bengaluru, Karnataka" */
  label: string;
  lat: number;
  lon: number;
}

interface OsmSearchPlace extends OsmPlace {
  display_name?: string;
}

/** Nominatim search hits as pickable suggestions; results without coordinates are dropped. */
export function placesFromOsm(places: unknown): PlaceSuggestion[] {
  if (!Array.isArray(places)) return [];
  const suggestions: PlaceSuggestion[] = [];
  for (const place of places as OsmSearchPlace[]) {
    const lat = place.lat?.trim() ? Number(place.lat) : NaN;
    const lon = place.lon?.trim() ? Number(place.lon) : NaN;
    const display = (place.display_name ?? "").replace(/\s+/g, " ").trim();
    if (!display || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const label = display
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part && !/city corporation|\burban\b|\brural\b/i.test(part))
      .slice(0, 3)
      .join(", ");
    suggestions.push({ label, lat, lon });
    if (suggestions.length >= 5) break;
  }
  return suggestions;
}

/** Live place search for the location form: partial addresses ("Indiranagar") return real, pickable places. */
export async function searchPlaces(text: string, fetchPage: typeof fetch = fetch): Promise<PlaceSuggestion[]> {
  const query = text.trim();
  if (query.length < 3) return [];
  try {
    const response = await fetchPage(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=5`, { headers: { accept: "application/json" } });
    if (!response.ok) return [];
    return placesFromOsm(await response.json());
  } catch {
    return [];
  }
}

async function geocode(address: string, fetchPage: typeof fetch): Promise<Coords | undefined> {
  try {
    const response = await fetchPage(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=jsonv2&limit=1`, { headers: { accept: "application/json" } });
    if (!response.ok) return undefined;
    const [place] = (await response.json()) as OsmPlace[];
    const lat = Number(place?.lat);
    const lon = Number(place?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
  } catch {
    return undefined;
  }
}

export async function find(client: llm.LlmClient, job: JobPosting, options: { webSearch: boolean }, fetchPage: typeof fetch = fetch): Promise<CompanyOffice> {
  const city = cityOf(job.location);
  // OpenStreetMap first: exact, structured addresses. The web + model path below is the fallback for companies OSM does not know.
  if (options.webSearch && job.company && city) {
    const osm = await searchOsm(job.company, city, fetchPage);
    if (osm) return osm;
  }
  const results = options.webSearch && job.company ? await searchWeb(job.company, city, fetchPage) : [];
  // no snippets, no answer: an address from the model alone would be a guess
  if (!results.length) return { addresses: [], match: "none", city, sources: [] };
  const raw = await llm.chatJson<unknown>(client, { system: officeSystem, user: buildPrompt(job, city, results), maxTokens: normalize.tokenBudget });
  const found = normalizeOffice(raw, results, city);
  // coordinates for the first address only, so the header can estimate peak travel time
  if (found.addresses[0] && found.addresses[0].lat === undefined) {
    const coords = await geocode(found.addresses[0].address, fetchPage);
    if (coords) found.addresses[0] = { ...found.addresses[0], ...coords };
  }
  return found;
}
