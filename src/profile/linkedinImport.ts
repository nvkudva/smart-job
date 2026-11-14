import * as linkedinProfile from "../ai/linkedinProfile.ts";
import type { LlmClient } from "../ai/llm.ts";
import * as storage from "../storage.ts";

interface PageStep {
  label: string;
  path: string;
  scrolls: number;
}

const pageSteps: PageStep[] = [
  { label: "Profile", path: "", scrolls: 3 },
  { label: "Experience", path: "details/experience/", scrolls: 3 },
  { label: "Education", path: "details/education/", scrolls: 2 },
  { label: "Skills", path: "details/skills/", scrolls: 3 },
  { label: "Certifications", path: "details/certifications/", scrolls: 2 },
  { label: "Recent activity", path: "recent-activity/all/", scrolls: 6 },
];

const ownProfileUrl = "https://www.linkedin.com/in/me/";
const loadTimeoutMs = 30000;
const minimumTextLength = 200;
const loginMessage = "You are not logged in to LinkedIn. Log in at linkedin.com in this browser, then try again.";

export type StatusListener = (message: string) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** LinkedIn flags rapid page loads, so each visit is spaced 2-3 s apart. */
function politePause(): Promise<void> {
  return sleep(2000 + Math.random() * 1000);
}

/** Resolves on "complete", or after the timeout so a stuck tracker script cannot block a readable page. */
function waitForLoad(tabId: number, isAlreadyLoading: boolean): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (updatedId: number, change: { status?: string }) => {
      if (updatedId === tabId && change.status === "complete") finish();
    };
    const timer = setTimeout(finish, loadTimeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    if (!isAlreadyLoading) void chrome.tabs.get(tabId).then((tab) => tab.status === "complete" && finish());
  });
}

async function navigate(tabId: number, url: string): Promise<void> {
  const loaded = waitForLoad(tabId, true);
  await chrome.tabs.update(tabId, { url });
  await loaded;
}

/** Runs inside the LinkedIn page: waits for content, scrolls to trigger lazy sections, returns the main text. Must stay self-contained. */
async function scrapeMain(scrolls: number): Promise<string> {
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const readText = () => (document.querySelector("main") as HTMLElement | null)?.innerText ?? document.body.innerText;
  for (let waited = 0; waited < 6000 && readText().length < 300; waited += 500) await pause(500);
  for (let step = 0; step < scrolls; step++) {
    window.scrollBy(0, window.innerHeight * 1.5);
    document.querySelector("main")?.lastElementChild?.scrollIntoView();
    await pause(700);
  }
  return readText().slice(0, 20000);
}

async function readPage(tabId: number, scrolls: number): Promise<string> {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func: scrapeMain, args: [scrolls] });
  return typeof results[0]?.result === "string" ? results[0].result : "";
}

async function assertLoggedIn(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ?? tab.pendingUrl ?? "";
  if (linkedinProfile.isLoginUrl(url)) throw new Error(loginMessage);
  return url;
}

async function visitAll(tabId: number, startUrl: string, onStatus: StatusListener): Promise<{ pages: linkedinProfile.PageText[]; profileUrl: string }> {
  const pages: linkedinProfile.PageText[] = [];
  let root = startUrl;
  for (const [index, step] of pageSteps.entries()) {
    onStatus(`Reading LinkedIn ${step.label.toLowerCase()} (${index + 1}/${pageSteps.length})…`);
    if (index === 0) await waitForLoad(tabId, false);
    else {
      await politePause();
      await navigate(tabId, `${root}${step.path}`);
    }
    const url = await assertLoggedIn(tabId);
    if (index === 0) root = linkedinProfile.profileRoot(url) || root;
    // LinkedIn bounces to the profile when a section does not exist
    else if (!url.includes(step.path)) continue;
    pages.push({ label: step.label, text: await readPage(tabId, step.scrolls) });
  }
  return { pages, profileUrl: root };
}

async function collect(startUrl: string, onStatus: StatusListener) {
  const tab = await chrome.tabs.create({ url: startUrl, active: false });
  const tabId = tab.id!;
  try {
    return await visitAll(tabId, startUrl, onStatus);
  } finally {
    await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

/** Reads the user's own LinkedIn pages, asks the AI to structure them, and merges the result into the stored profile. */
export async function run(client: LlmClient, onStatus: StatusListener): Promise<void> {
  const current = await storage.get("profile");
  const { pages, profileUrl } = await collect(linkedinProfile.profileRoot(current.linkedin) || ownProfileUrl, onStatus);
  const totalLength = pages.reduce((sum, page) => sum + page.text.length, 0);
  if (totalLength < minimumTextLength) throw new Error("Could not read your LinkedIn profile. Open it in a normal tab, check it loads, and try again.");
  onStatus("Summarising your LinkedIn profile with AI…");
  const imported = await linkedinProfile.extract(client, pages, profileUrl);
  await storage.set("profile", linkedinProfile.merge(await storage.get("profile"), imported));
  await storage.set("linkedinImportedAt", Date.now());
}
