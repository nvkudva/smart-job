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
import { Results } from "./results.tsx";

interface SourceStatus {
  name: string;
  isLoading: boolean;
  count: number;
  error: string;
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

  const start = (next: SearchQuery) => {
    const searchId = ++latestSearch.current;
    const sources = jobSources.forCountry(country);
    const settle = (name: string, change: Partial<SourceStatus>) => {
      if (searchId !== latestSearch.current) return;
      setStatuses((current) => current.map((status) => (status.name === name ? { ...status, isLoading: false, ...change } : status)));
    };
    setQuery(next);
    setJobs([]);
    setStatuses(sources.map((source) => ({ name: source.name, isLoading: true, count: 0, error: "" })));
    for (const source of sources) {
      source.search(next).then(
        (found) => {
          if (searchId !== latestSearch.current) return;
          setJobs((current) => {
            const knownIds = new Set(current.map((job) => job.id));
            return [...current, ...found.filter((job) => !knownIds.has(job.id))];
          });
          settle(source.name, { count: found.length });
        },
        (failure) => settle(source.name, { error: failure instanceof Error ? failure.message : String(failure) }),
      );
    }
  };
  return { query, jobs, statuses, start };
}

interface SearchFormProps {
  initialLocation: string;
  suggestedRoles: string[];
  isCompact: boolean;
  onSearch: (query: SearchQuery) => void;
}

function SearchForm({ initialLocation, suggestedRoles, isCompact, onSearch }: SearchFormProps) {
  const [role, setRole] = useState("");
  const [location, setLocation] = useState(initialLocation);
  const search = (wantedRole: string) => {
    const trimmed = wantedRole.trim();
    if (trimmed) onSearch({ role: trimmed, location: location.trim() });
  };
  return (
    <form
      class="sj-form"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        search(role);
      }}
    >
      <label class="sj-role">
        <span class="sr-only">Role</span>
        <input type="text" value={role} placeholder="Job title, e.g. Product Manager" onInput={(event) => setRole(event.currentTarget.value)} />
      </label>
      <label class="sj-where">
        <span class="sr-only">Location</span>
        <input type="text" value={location} placeholder="Location" onInput={(event) => setLocation(event.currentTarget.value)} />
      </label>
      <button type="submit" class="btn primary">
        Search
      </button>
      {!isCompact && (
        <div class="chips sj-suggestions">
          {suggestedRoles.map((suggested) => (
            <button
              type="button"
              class="chip role"
              onClick={() => {
                setRole(suggested);
                search(suggested);
              }}
            >
              {suggested}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

function SourceStatuses({ statuses }: { statuses: SourceStatus[] }) {
  return (
    <ul class="chips sj-status" aria-label="Portals">
      {statuses.map((status) => (
        <li class={`chip${status.error ? " warn" : ""}`}>
          {status.name}
          {status.isLoading && <Spinner />}
          {status.error && `: ${status.error}`}
          {!status.isLoading && !status.error && ` · ${status.count}`}
        </li>
      ))}
    </ul>
  );
}

function Body({ jobs, statuses, country }: { jobs: FoundJob[]; statuses: SourceStatus[]; country: string }) {
  if (!statuses.length) return <p class="muted sj-note">No job portals cover {country || "your country"} yet.</p>;
  const isSettled = statuses.every((status) => !status.isLoading);
  if (isSettled && !jobs.length) return <p class="muted sj-note">No jobs found for that search.</p>;
  return (
    <div class="sj-body">
      <Results jobs={jobs} />
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
  const hasSearched = search.query !== null;
  return (
    <div class={`sj ${hasSearched ? "sj-results-mode" : "sj-home"}`}>
      <header class="sj-top">
        <h1 class="sj-brand">Super Job</h1>
        <SearchForm initialLocation={profile.city} suggestedRoles={suggestedRoles} isCompact={hasSearched} onSearch={search.start} />
        {hasSearched && <SourceStatuses statuses={search.statuses} />}
        {hasSearched && !profile.country.trim() && <p class="muted small">Add your country in Profile to also search local job portals.</p>}
      </header>
      {hasSearched && <Body jobs={search.jobs} statuses={search.statuses} country={profile.country} />}
    </div>
  );
}

render(<App />, document.getElementById("root")!);
