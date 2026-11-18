import * as storage from "../storage.ts";
import type { SearchQuery } from "./jobSources.ts";

const maxKept = 8;

const isSame = (left: SearchQuery, right: SearchQuery) => left.role.toLowerCase() === right.role.toLowerCase() && left.location.toLowerCase() === right.location.toLowerCase();

/** Newest first, without repeats, capped. */
export function withQuery(recent: SearchQuery[], query: SearchQuery): SearchQuery[] {
  return [query, ...recent.filter((kept) => !isSame(kept, query))].slice(0, maxKept);
}

export async function remember(query: SearchQuery): Promise<void> {
  await storage.set("recentSearches", withQuery(await storage.get("recentSearches"), query));
}

export async function forget(query: SearchQuery): Promise<void> {
  await storage.set("recentSearches", (await storage.get("recentSearches")).filter((kept) => !isSame(kept, query)));
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    </svg>
  );
}

interface RecentPillsProps {
  recent: SearchQuery[];
  /** hidden from the pills: the search on screen */
  current: SearchQuery | null;
  onPick: (query: SearchQuery) => void;
}

const pillCount = 3;

/** The last few searches as pills, to jump back quickly. */
export function RecentPills({ recent, current, onPick }: RecentPillsProps) {
  const shown = recent.filter((query) => !current || !isSame(query, current)).slice(0, pillCount);
  if (!shown.length) return null;
  return (
    <div class="sj-roles" role="group" aria-label="Recent searches">
      {shown.map((query) => (
        <button key={`${query.role}|${query.location}`} type="button" class="sj-role-chip" onClick={() => onPick(query)}>
          <ClockIcon />
          {query.role}
          {query.location && <span class="sj-recent-where"> · {query.location}</span>}
        </button>
      ))}
    </div>
  );
}

export interface Suggestion {
  kind: "recent" | "role";
  query: SearchQuery;
}

const shownRecent = 5;
const shownRoles = 6;

/** Recent searches first, then suggested roles; both narrowed to what has been typed. */
export function suggestionsFor(typed: string, recent: SearchQuery[], suggestedRoles: string[], location: string): Suggestion[] {
  const needle = typed.trim().toLowerCase();
  const matches = (role: string) => role.toLowerCase().includes(needle) && role.toLowerCase() !== needle;
  const fromRecent = recent.filter((query) => matches(query.role)).slice(0, shownRecent);
  const recentRoles = new Set(fromRecent.map((query) => query.role.toLowerCase()));
  const fromRoles = suggestedRoles.filter((role) => matches(role) && !recentRoles.has(role.toLowerCase())).slice(0, shownRoles);
  return [
    ...fromRecent.map((query): Suggestion => ({ kind: "recent", query })),
    ...fromRoles.map((role): Suggestion => ({ kind: "role", query: { role, location } })),
  ];
}

interface SuggestionListProps {
  items: Suggestion[];
  activeIndex: number;
  onPick: (query: SearchQuery) => void;
}

export function SuggestionList({ items, activeIndex, onPick }: SuggestionListProps) {
  if (!items.length) return null;
  const firstRoleIndex = items.findIndex((item) => item.kind === "role");
  return (
    // mousedown must not blur the input, or the list would close before the click lands
    <ul class="sj-suggest" role="listbox" aria-label="Suggestions" onMouseDown={(event) => event.preventDefault()}>
      {items.map((item, index) => (
        <>
          {(index === 0 || index === firstRoleIndex) && <li class="sj-suggest-label" role="presentation">{item.kind === "recent" ? "Recent" : "Suggested roles"}</li>}
          <li key={`${item.kind}|${item.query.role}|${item.query.location}`} class={`sj-suggest-item${index === activeIndex ? " is-active" : ""}`} role="option" aria-selected={index === activeIndex}>
            <button type="button" class="sj-suggest-pick" onClick={() => onPick(item.query)}>
              {item.kind === "recent" ? <ClockIcon /> : <SparkIcon />}
              <span>{item.query.role}</span>
              {item.kind === "recent" && item.query.location && <span class="sj-recent-where"> · {item.query.location}</span>}
            </button>
            {item.kind === "recent" && (
              <button type="button" class="sj-recent-remove" aria-label={`Remove ${item.query.role} from recent searches`} title="Remove" onClick={() => void forget(item.query)}>
                ×
              </button>
            )}
          </li>
        </>
      ))}
    </ul>
  );
}
