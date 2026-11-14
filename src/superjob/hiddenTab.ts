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

/** Opens url in an inactive tab, runs func in it and returns its string result; the tab is always closed. */
export async function run<Args extends unknown[]>(url: string, func: (...args: Args) => string | Promise<string>, args: Args): Promise<string> {
  const tab = await chrome.tabs.create({ url, active: false });
  const tabId = tab.id!;
  try {
    await linkedinImport.waitForLoad(tabId, false);
    const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    const result = results[0]?.result;
    return typeof result === "string" ? result : "";
  } finally {
    await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

/** HTML of the container once readySelector appears; throws when the portal never shows it. */
export async function read(portal: string, url: string, readySelector: string, containerSelector: string): Promise<string> {
  const html = await run(url, waitForContainer, [readySelector, containerSelector, readyTimeoutMs]);
  if (!html) throw new Error(`${portal} did not load in time`);
  return html;
}
