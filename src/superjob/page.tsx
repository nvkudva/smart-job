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
import { filterByPortals, PortalIcon } from "./jobList.tsx";
import { SignInRequired } from "./http.ts";
import * as posting from "./posting.ts";
import * as recentSearches from "./recentSearches.tsx";
import { RecentPills, SuggestionList, suggestionsFor } from "./recentSearches.tsx";
import { Results, useChosenJob } from "./results.tsx";

interface SourceStatus {
  name: string;
  isLoading: boolean;
  count: number;
  error: string;
  /** set when the portal needs the user signed in */
  loginUrl: string;
  /** false once a page came back empty or failed */
  hasMore: boolean;
}

const isIdleWithMore = (statuses: SourceStatus[], name: string) => statuses.some((status) => status.name === name && status.hasMore && !status.isLoading);

function useSuggestedRoles(profile: Profile): string[] {
  const searches = useStored("jobSearches");
  const [suggested, setSuggested] = useState<string[]>([]);
  const isLoaded = searches !== undefined;
  const hasSaved = !!searches?.length;
  useEffect(() => {
    if (!isLoaded || hasSaved) return;
    let isAlive = true;
    void aiClient
      .withClient((client) => roles.suggest(client, profile))
      .catch(() => roles.fallback(profile))
      .then((next) => {
        if (isAlive) setSuggested(next);
      });
    return () => {
      isAlive = false;
    };
  }, [isLoaded, hasSaved, profile]);
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
        (failure) => settle(source.name, { error: failure instanceof Error ? failure.message : String(failure), loginUrl: failure instanceof SignInRequired ? failure.loginUrl : "", hasMore: false }),
      );
    }
  };

  const start = (next: SearchQuery) => {
    const searchId = ++latestSearch.current;
    const sources = jobSources.forCountry(country);
    nextPage.current = {};
    setQuery(next);
    setJobs([]);
    setStatuses(sources.map((source) => ({ name: source.name, isLoading: true, count: 0, error: "", loginUrl: "", hasMore: true })));
    fetchPage(sources, next, searchId);
  };

  const loadMore = (hiddenPortals: ReadonlySet<string>) => {
    if (!query) return;
    const sources = jobSources.forCountry(country).filter((source) => !hiddenPortals.has(source.name) && isIdleWithMore(statuses, source.name));
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
  recent: SearchQuery[];
  suggestedRoles: string[];
  onPick: (query: SearchQuery) => void;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function SearchForm({ role, location, onRole, onLocation, onSearch, recent, suggestedRoles, onPick }: SearchFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const items = isOpen ? suggestionsFor(role, recent, suggestedRoles, location) : [];
  const pick = (query: SearchQuery) => {
    setIsOpen(false);
    onPick(query);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") return setIsOpen(false);
    if (!items.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((activeIndex + step + items.length + 1) % (items.length + 1) - 1);
    }
    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      pick(items[activeIndex]!.query);
    }
  };
  return (
    <form
      class="sj-form"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        setIsOpen(false);
        onSearch(role);
      }}
    >
      <div class="sj-search">
        <label class="sj-seg sj-seg-what">
          <span class="sj-seg-label">Role</span>
          <input
            type="text"
            class="sj-input"
            value={role}
            placeholder="Job title, e.g. Product Manager"
            autocomplete="off"
            onInput={(event) => {
              onRole(event.currentTarget.value);
              setActiveIndex(-1);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onBlur={() => setIsOpen(false)}
            onKeyDown={onKeyDown}
          />
        </label>
        <span class="sj-seg-divider" aria-hidden="true" />
        <label class="sj-seg sj-seg-where">
          <span class="sj-seg-label">Where</span>
          <input type="text" class="sj-input" value={location} placeholder="City or region" autocomplete="off" onInput={(event) => onLocation(event.currentTarget.value)} />
        </label>
        <button type="submit" class="sj-go" aria-label="Search">
          <SearchIcon />
          Search
        </button>
        <SuggestionList items={items} activeIndex={activeIndex} onPick={pick} />
      </div>
    </form>
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
          <li key={status.name}>
            <button type="button" class={`chip pick${hiddenPortals.has(status.name) ? "" : " active"}${status.error ? " warn" : ""}`} aria-pressed={!hiddenPortals.has(status.name)} onClick={() => onToggle(status.name)}>
              <PortalIcon name={status.name} />
              {status.name}
              {status.isLoading && <Spinner />}
              {!status.isLoading && !status.error && <span class="sj-chip-count">{status.count}</span>}
              {status.error && (
                <span class="sj-chip-error" title={status.error}>
                  <span aria-hidden="true">⚠</span> {status.loginUrl ? "Sign in" : /in time/.test(status.error) ? "Timed out" : "Failed"}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <p class="sj-total" aria-live="polite">
        {jobCount} {jobCount === 1 ? "job" : "jobs"}
      </p>
      {statuses.filter((status) => status.loginUrl).map((status) => (
        <p key={status.name} class="muted small sj-signin">
          {status.name} shows jobs only when you are signed in.{" "}
          <a href={status.loginUrl} target="_blank" rel="noreferrer">
            Sign in
          </a>
          , then search again.
        </p>
      ))}
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
  const canLoadMore = search.statuses.some((status) => status.hasMore && !status.isLoading && !hiddenPortals.has(status.name));
  const recent = useStored("recentSearches") ?? [];
  const runSearch = (wantedRole: string, wantedLocation = location) => {
    const trimmed = wantedRole.trim();
    if (!trimmed) return;
    const query = { role: trimmed, location: wantedLocation.trim() };
    setHiddenPortals(new Set());
    search.start(query);
    void recentSearches.remember(query);
  };
  const pickQuery = (picked: SearchQuery) => {
    setRole(picked.role);
    setLocation(picked.location);
    runSearch(picked.role, picked.location);
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
          <h1 class="sj-brand">
            <img class="sj-brand-logo" src="icons/128.png" alt="" />
            Super Job
          </h1>
          <SearchForm role={role} location={location} onRole={setRole} onLocation={setLocation} onSearch={runSearch} recent={recent} suggestedRoles={suggestedRoles} onPick={pickQuery} />
        </div>
        <div class="sj-sub">
          <RecentPills recent={recent} current={search.query} onPick={pickQuery} />
          {hasSearched && <PortalFilters statuses={search.statuses} hiddenPortals={hiddenPortals} jobCount={visibleJobs.length} onToggle={togglePortal} />}
        </div>
        {hasSearched && !profile.country.trim() && <p class="muted small sj-hint">Add your country in Profile to also search local job portals.</p>}
      </header>
      {hasSearched && <Body jobs={search.jobs} visibleJobs={visibleJobs} statuses={search.statuses} country={profile.country} chosen={chosen} onLoadMore={canLoadMore ? () => search.loadMore(hiddenPortals) : undefined} />}
    </div>
  );
}

render(<App />, document.getElementById("root")!);
