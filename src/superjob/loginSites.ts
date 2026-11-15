import * as session from "../fill/session.ts";
import * as linkedinImport from "../profile/linkedinImport.ts";

const pollMs = 2000;
const maxWaitMs = 5 * 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface LoginSite {
  name: string;
  origin: string;
  loginUrl: string;
  /** Runs inside the site's own tab as well as here, so it must stay self-contained; `base` is "" on the site itself. True while the session is valid. */
  hasSession: (base: string) => Promise<boolean>;
}

/** Signed out, the search page redirects away from /jobs; signed in, it stays there. */
async function greenhouseHasSession(base: string): Promise<boolean> {
  try {
    const response = await fetch(`${base}/jobs/search`, { credentials: "include" });
    return response.ok && new URL(response.url).pathname.startsWith("/jobs");
  } catch {
    return false;
  }
}

const greenhouse: LoginSite = { name: "Greenhouse", origin: "https://my.greenhouse.io", loginUrl: "https://my.greenhouse.io/jobs/search", hasSession: greenhouseHasSession };

export const sites: LoginSite[] = [greenhouse];

export const isSignedIn = (site: LoginSite) => site.hasSession(site.origin);

/** Asks from inside the site's own tab, where its cookies always apply; false while the tab is mid-navigation. */
async function isSignedInTab(site: LoginSite, tabId: number): Promise<boolean> {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func: site.hasSession, args: [""] }).catch(() => []);
  return results[0]?.result === true;
}

/** Types the saved job-site email into the login page; the user still clicks Sign in. */
async function prefill(tabId: number): Promise<void> {
  await linkedinImport.waitForLoad(tabId, false);
  await session.run(tabId, null, { useAi: false, includeAccount: true }).catch(() => undefined);
}

/** Opens the login page, waits for the user to sign in, then closes it and brings the caller's tab back. Resolves false when the page was closed or the wait ran out. */
export async function connect(site: LoginSite, canPrefill: boolean): Promise<boolean> {
  const caller = await chrome.tabs.getCurrent();
  const loginTab = await chrome.tabs.create({ url: site.loginUrl });
  const loginTabId = loginTab.id!;
  if (canPrefill) void prefill(loginTabId);
  for (let waited = 0; waited < maxWaitMs; waited += pollMs) {
    await sleep(pollMs);
    if ((await isSignedInTab(site, loginTabId)) || (await isSignedIn(site))) {
      await chrome.tabs.remove(loginTabId).catch(() => undefined);
      if (caller?.id) await chrome.tabs.update(caller.id, { active: true });
      return true;
    }
    if (!(await chrome.tabs.get(loginTabId).catch(() => undefined))) return false;
  }
  return false;
}
