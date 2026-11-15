import type { TrackedJob } from "../../types.ts";

function pageKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

/** Open tab showing the job posting or the application page; ignores hash, query and a trailing slash. */
export function findTab(entry: TrackedJob, tabs: chrome.tabs.Tab[]): chrome.tabs.Tab | undefined {
  const wanted = [entry.portalUrl, entry.job.url].filter(Boolean).map((url) => pageKey(url!));
  return tabs.find((tab) => !!tab.url && wanted.includes(pageKey(tab.url)));
}

/** Brings the job's tab to the front, or opens the posting in a new tab when it is closed. */
export async function open(entry: TrackedJob): Promise<void> {
  const existing = findTab(entry, await chrome.tabs.query({}));
  if (!existing?.id) {
    await chrome.tabs.create({ url: entry.job.url });
    return;
  }
  await chrome.tabs.update(existing.id, { active: true });
  if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
}
