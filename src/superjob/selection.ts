import type { JobPosting } from "../types.ts";

/** What a Super Job tab currently shows; the side panel reads it because content scripts never run on extension pages. */
export interface Selection {
  /** null while nothing is selected or the description is still loading */
  job: JobPosting | null;
  isLoading: boolean;
}

const storageKey = "superjobSelections";

type Selections = Record<string, Selection>;

async function readAll(): Promise<Selections> {
  const stored = await chrome.storage.session.get(storageKey);
  return (stored[storageKey] as Selections | undefined) ?? {};
}

export function isPage(url: string): boolean {
  return url.startsWith(chrome.runtime.getURL("superjob.html"));
}

export async function publish(tabId: number, selection: Selection): Promise<void> {
  const all = await readAll();
  await chrome.storage.session.set({ [storageKey]: { ...all, [tabId]: selection } });
}

export async function read(tabId: number): Promise<Selection | null> {
  const all = await readAll();
  return all[tabId] ?? null;
}

export function onChange(listener: () => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "session" && storageKey in changes) listener();
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
