import * as linkedinImport from "../profile/linkedinImport.ts";

const readyTimeoutMs = 15000;

/** Runs inside the portal page: waits for the ready selector, returns the container's HTML. Must stay self-contained. */
async function waitForContainer(readySelector: string, containerSelector: string, timeoutMs: number): Promise<string> {
  for (let waited = 0; waited < timeoutMs; waited += 500) {
    if (document.querySelector(readySelector)) return document.querySelector(containerSelector)?.outerHTML ?? "";
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return "";
}

let queue: Promise<unknown> = Promise.resolve();
const openTabIds = new Set<number>();
let isCleanupRegistered = false;

/** The page's scripts stop when it closes, so the finally blocks below never run; this closes the tabs it left open. */
function closeLeftoverTabsOnPageClose(): void {
  if (isCleanupRegistered) return;
  isCleanupRegistered = true;
  addEventListener("pagehide", () => void chrome.tabs.remove([...openTabIds]).catch(() => undefined));
}

async function useTab<Result>(url: string, use: (tabId: number) => Promise<Result>): Promise<Result> {
  const tab = await chrome.tabs.create({ url, active: false });
  const tabId = tab.id!;
  openTabIds.add(tabId);
  try {
    await linkedinImport.waitForLoad(tabId, false);
    return await use(tabId);
  } finally {
    openTabIds.delete(tabId);
    await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

/** Opens url in an inactive tab that has finished loading, runs use, always closes the tab. One tab at a time, so quick repeat searches cannot pile up heavy portal pages. */
export function withTab<Result>(url: string, use: (tabId: number) => Promise<Result>): Promise<Result> {
  closeLeftoverTabsOnPageClose();
  const turn = queue.then(() => useTab(url, use));
  queue = turn.catch(() => undefined);
  return turn;
}

/** Runs func in the page and returns its string result. */
export function run<Args extends unknown[]>(url: string, func: (...args: Args) => string | Promise<string>, args: Args): Promise<string> {
  return withTab(url, async (tabId) => {
    const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    const result = results[0]?.result;
    return typeof result === "string" ? result : "";
  });
}

/** HTML of the container once readySelector appears; throws when the portal never shows it. */
export async function read(portal: string, url: string, readySelector: string, containerSelector: string): Promise<string> {
  const html = await run(url, waitForContainer, [readySelector, containerSelector, readyTimeoutMs]);
  if (!html) throw new Error(`${portal} did not load in time`);
  return html;
}
