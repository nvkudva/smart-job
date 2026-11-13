import type { JobSearch } from "../../types.ts";

/** Opens in a new tab through chrome.tabs so the side panel stays put. */
export function JobSearchLinks({ searches }: { searches: JobSearch[] }) {
  if (!searches.length) return null;
  return (
    <ul class="search-links">
      {searches.map((search) => (
        <li>
          <a
            href={search.url}
            onClick={(event) => {
              event.preventDefault();
              void chrome.tabs.create({ url: search.url });
            }}
          >
            {search.role}
          </a>
          {search.location && <span class="muted small"> · {search.location}</span>}
        </li>
      ))}
    </ul>
  );
}
