import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import * as roles from "../ai/roles.ts";
import * as normalize from "../ai/normalize.ts";
import * as aiClient from "../panel/shared/aiClient.ts";
import { Spinner } from "../panel/shared/controls.tsx";
import { useStored } from "../panel/shared/useStored.ts";
import type { Profile } from "../types.ts";
import type { FoundJob, SearchQuery } from "./jobSources.ts";
import * as jobSources from "./jobSources.ts";
import { ConnectCard } from "./connectCard.tsx";
import { filterByPortals } from "./jobList.tsx";
import * as posting from "./posting.ts";
import { Results, useChosenJob } from "./results.tsx";

interface SourceStatus {
  name: string;
  isLoading: boolean;
  count: number;
  error: string;
  /** false once a page came back empty or failed */
  hasMore: boolean;
}

function useSuggestedRoles(profile: Profile): string[] {
  const searches = useStored("jobSearches");
  const [suggested, setSuggested] = useState<string[]>([]);
  const isLoaded = searches !== undefined;
  const hasSaved = !!searches?.length;
  useEffect(() => {
    if (!isLoaded || hasSaved) return;
    void aiClient
      .withClient((client) => roles.suggest(client, profile))
      .catch(() => roles.fallback(profile))
      .then(setSuggested);
  }, [isLoaded, hasSaved]);
  return hasSaved ? normalize.dedupe(searches.map((search) => search.role)) : suggested;
}

/** A newer search bumps latestSearch, so late answers of an older one are dropped. */
function useSearch(country: string) {
  const [query, setQuery] = useState<SearchQuery | null>(null);
  const [jobs, setJobs] = useState<FoundJob[]>([]);
  const [statuses, setStatuses] = useState<SourceStatus[]>([]);
  const latestSearch = useRef(0);
  const nextPage = useRef<Record<string, number>>({});

  const fetchPage = (sources: jobSources.Source[], searchQuery: SearchQuery, searchId: number) => {
    const settle = (name: string, change: Partial<SourceStatus>) => {
      if (searchId !== latestSearch.current) return;
      setStatuses((current) => current.map((status) => (status.name === name ? { ...status, isLoading: false, ...change } : status)));
    };
    for (const source of sources) {
      const page = nextPage.current[source.name] ?? 0;
      source.search(searchQuery, page).then(
        (allFound) => {
          if (searchId !== latestSearch.current) return;
          const found = allFound.filter(posting.hasOpenableUrl);
          nextPage.current[source.name] = page + 1;
          setJobs((current) => {
            const knownIds = new Set(current.map((job) => job.id));
            return [...current, ...found.filter((job) => !knownIds.has(job.id))];
          });
          setStatuses((current) => current.map((status) => (status.name === source.name ? { ...status, count: status.count + found.length } : status)));
          settle(source.name, { hasMore: found.length > 0 });
        },
        (failure) => settle(source.name, { error: failure instanceof Error ? failure.message : String(failure), hasMore: false }),
      );
    }
  };

  const start = (next: SearchQuery) => {
    const searchId = ++latestSearch.current;
    const sources = jobSources.forCountry(country);
    nextPage.current = {};
    setQuery(next);
    setJobs([]);
    setStatuses(sources.map((source) => ({ name: source.name, isLoading: true, count: 0, error: "", hasMore: true })));
    fetchPage(sources, next, searchId);
  };

  const loadMore = (hiddenPortals: ReadonlySet<string>) => {
    if (!query) return;
    const sources = jobSources.forCountry(country).filter((source) => !hiddenPortals.has(source.name) && statuses.find((status) => status.name === source.name)?.hasMore);
    const names = new Set(sources.map((source) => source.name));
    setStatuses((current) => current.map((status) => (names.has(status.name) ? { ...status, isLoading: true } : status)));
    fetchPage(sources, query, latestSearch.current);
  };
  return { query, jobs, statuses, start, loadMore };
}

interface SearchFormProps {
  role: string;
  location: string;
  onRole: (role: string) => void;
  onLocation: (location: string) => void;
  onSearch: (role: string) => void;
}

function SearchIcon() {
  return (
    <svg class="sj-search-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

/** Reads as a line of text under the search bar; a click turns it into an input that settles on Enter, Escape or blur. */
function LocationLine({ location, onLocation }: { location: string; onLocation: (location: string) => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isEditing) inputRef.current?.select();
  }, [isEditing]);
  if (isEditing) {
    return (
      <label class="sj-where is-editing">
        <PinIcon />
        <span class="sr-only">Location</span>
        <input
          ref={inputRef}
          type="text"
          value={location}
          placeholder="City or region"
          onInput={(event) => onLocation(event.currentTarget.value)}
          onBlur={() => setIsEditing(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setIsEditing(false);
          }}
        />
      </label>
    );
  }
  return (
    <button type="button" class="sj-where" onClick={() => setIsEditing(true)}>
      <PinIcon />
      <span>{location.trim() ? `Jobs in ${location.trim()}` : "Anywhere"}</span>
      <span class="sj-where-edit">{location.trim() ? "Change" : "Add a location"}</span>
    </button>
  );
}

function SearchForm({ role, location, onRole, onLocation, onSearch }: SearchFormProps) {
  return (
    <form
      class="sj-form"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(role);
      }}
    >
      <div class="sj-search">
        <SearchIcon />
        <input type="text" class="sj-input" value={role} placeholder="Search job titles, e.g. Product Manager" aria-label="Role" onInput={(event) => onRole(event.currentTarget.value)} />
        <button type="submit" class="sj-go" aria-label="Search">
          Search
        </button>
      </div>
      <LocationLine location={location} onLocation={onLocation} />
    </form>
  );
}

function RoleChips({ roles: suggestedRoles, onPick }: { roles: string[]; onPick: (role: string) => void }) {
  if (!suggestedRoles.length) return null;
  return (
    <div class="sj-roles" role="group" aria-label="Suggested roles">
      {suggestedRoles.map((suggested) => (
        <button type="button" class="sj-role-chip" onClick={() => onPick(suggested)}>
          {suggested}
        </button>
      ))}
    </div>
  );
}

interface PortalFiltersProps {
  statuses: SourceStatus[];
  hiddenPortals: ReadonlySet<string>;
  jobCount: number;
  onToggle: (name: string) => void;
}

function PortalFilters({ statuses, hiddenPortals, jobCount, onToggle }: PortalFiltersProps) {
  return (
    <div class="sj-filters">
      <ul class="sj-status" aria-label="Portals">
        {statuses.map((status) => (
          <li>
            <button type="button" class={`chip pick${hiddenPortals.has(status.name) ? "" : " active"}${status.error ? " warn" : ""}`} aria-pressed={!hiddenPortals.has(status.name)} onClick={() => onToggle(status.name)}>
              {status.name}
              {status.isLoading && <Spinner />}
              {!status.isLoading && !status.error && <span class="sj-chip-count">{status.count}</span>}
              {status.error && (
                <span class="sj-chip-error" title={status.error}>
                  {status.error}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <p class="sj-total" aria-live="polite">
        {jobCount} {jobCount === 1 ? "job" : "jobs"}
      </p>
    </div>
  );
}

interface BodyProps {
  jobs: FoundJob[];
  visibleJobs: FoundJob[];
  statuses: SourceStatus[];
  country: string;
  chosen: ReturnType<typeof useChosenJob>;
  onLoadMore: (() => void) | undefined;
}

function Body({ jobs, visibleJobs, statuses, country, chosen, onLoadMore }: BodyProps) {
  if (!statuses.length) return <p class="muted sj-note">No job portals cover {country || "your country"} yet.</p>;
  const isLoading = statuses.some((status) => status.isLoading);
  if (!isLoading && !jobs.length) return <p class="muted sj-note">No jobs found for that search.</p>;
  return (
    <div class="sj-body">
      <Results jobs={visibleJobs} chosen={chosen} isLoading={isLoading} onLoadMore={onLoadMore} />
    </div>
  );
}

function App() {
  const profile = useStored("profile");
  if (!profile) return null;
  return <Page profile={profile} />;
}

function Page({ profile }: { profile: Profile }) {
  const suggestedRoles = useSuggestedRoles(profile);
  const search = useSearch(profile.country);
  const [role, setRole] = useState("");
  const [location, setLocation] = useState(profile.city);
  const [hiddenPortals, setHiddenPortals] = useState<ReadonlySet<string>>(new Set());
  const visibleJobs = filterByPortals(search.jobs, hiddenPortals);
  const chosen = useChosenJob(visibleJobs);
  const hasSearched = search.query !== null;
  const isLoadingAny = search.statuses.some((status) => status.isLoading);
  const canLoadMore = search.statuses.some((status) => status.hasMore && !hiddenPortals.has(status.name));
  const runSearch = (wantedRole: string) => {
    const trimmed = wantedRole.trim();
    if (!trimmed) return;
    setHiddenPortals(new Set());
    search.start({ role: trimmed, location: location.trim() });
  };
  const togglePortal = (name: string) => {
    const next = new Set(hiddenPortals);
    if (!next.delete(name)) next.add(name);
    setHiddenPortals(next);
  };
  return (
    <div class={`sj ${hasSearched ? "sj-results-mode" : "sj-home"}`}>
      <header class="sj-top">
        <div class="sj-bar">
          <h1 class="sj-brand">Super Job</h1>
          <SearchForm role={role} location={location} onRole={setRole} onLocation={setLocation} onSearch={runSearch} />
        </div>
        <div class="sj-sub">
          <RoleChips
            roles={suggestedRoles}
            onPick={(picked) => {
              setRole(picked);
              runSearch(picked);
            }}
          />
          {hasSearched && <PortalFilters statuses={search.statuses} hiddenPortals={hiddenPortals} jobCount={visibleJobs.length} onToggle={togglePortal} />}
        </div>
        {hasSearched && search.jobs.length > 0 && <ConnectCard />}
        {hasSearched && !profile.country.trim() && <p class="muted small sj-hint">Add your country in Profile to also search local job portals.</p>}
      </header>
      {hasSearched && <Body jobs={search.jobs} visibleJobs={visibleJobs} statuses={search.statuses} country={profile.country} chosen={chosen} onLoadMore={canLoadMore && !isLoadingAny ? () => search.loadMore(hiddenPortals) : undefined} />}
    </div>
  );
}

render(<App />, document.getElementById("root")!);
