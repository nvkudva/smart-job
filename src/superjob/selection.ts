import * as sessionTabs from "../sessionTabs.ts";
import type { JobPosting } from "../types.ts";

/** What a Super Job tab currently shows; the side panel reads it because content scripts never run on extension pages. */
export interface Selection {
  /** null while nothing is selected or the description is still loading */
  job: JobPosting | null;
  isLoading: boolean;
}

const key = "superjobSelection";

export function isPage(url: string): boolean {
  return url.startsWith(chrome.runtime.getURL("superjob.html"));
}

export const publish = (tabId: number, selection: Selection) => sessionTabs.write(key, tabId, selection);

export async function read(tabId: number): Promise<Selection | null> {
  return (await sessionTabs.read<Selection>(key, tabId)) ?? null;
}

export function onChange(listener: () => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "session" && Object.keys(changes).some((changed) => sessionTabs.isKeyFor(changed, key))) listener();
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
