import { useEffect, useRef, useState } from "preact/hooks";
import * as messages from "../../messages.ts";
import type { JobPosting } from "../../types.ts";

/** `?tabId=<id>` pins the tracked tab (used by e2e tests, where the panel itself is opened as a tab). */
const pinnedTabId = Number(new URLSearchParams(location.search).get("tabId")) || null;
const detectDelayMs = 700;
const retryDelayMs = 1000;
const maxRetries = 3;

interface TabInfo {
  tabId: number | null;
  url: string;
}

export interface ActiveJob extends TabInfo {
  host: string;
  job: JobPosting | null;
  isDetecting: boolean;
}

export async function readCurrentTab(): Promise<TabInfo> {
  const tab = pinnedTabId
    ? await chrome.tabs.get(pinnedTabId).catch(() => undefined)
    : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  return { tabId: tab?.id ?? null, url: tab?.url ?? "" };
}

/** Tracks which tab the panel follows; `version` bumps whenever that tab may show a different job. */
function useTrackedTab(): { tab: TabInfo; version: number } {
  const [tab, setTab] = useState<TabInfo>({ tabId: null, url: "" });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let isAlive = true;
    const refresh = async (isChange: boolean) => {
      const next = await readCurrentTab();
      if (!isAlive) return;
      setTab((previous) => (previous.tabId === next.tabId && previous.url === next.url ? previous : next));
      if (isChange) setVersion((value) => value + 1);
    };
    const isWatched = (candidate?: chrome.tabs.Tab) => !!candidate && (pinnedTabId ? candidate.id === pinnedTabId : !!candidate.active);
    const onActivated = () => !pinnedTabId && void refresh(true);
    const onUpdated = (_id: number, change: chrome.tabs.OnUpdatedInfo, updated: chrome.tabs.Tab) => {
      if (isWatched(updated) && (change.url || change.status === "complete")) void refresh(true);
    };
    const onMessage = (message: messages.ContentEvent, sender: chrome.runtime.MessageSender) => {
      if (message?.type === "jobChanged" && isWatched(sender.tab)) void refresh(true);
    };
    void refresh(false);
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      isAlive = false;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, []);
  return { tab, version };
}

/** First non-null job over all frames, preferring the top frame. */
async function extractJob(tabId: number): Promise<JobPosting | null> {
  const frameIds = await messages.listFrameIds(tabId).catch(() => [0]);
  const ordered = [...frameIds].sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : a - b));
  const results = await Promise.all(ordered.map((frameId) => messages.sendToFrame(tabId, frameId, { type: "extractJob" })));
  return results.find((result) => !!result) ?? null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function useDetectedJob(tab: TabInfo, version: number): { job: JobPosting | null; isDetecting: boolean } {
  const [job, setJob] = useState<JobPosting | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const lastPage = useRef("");
  useEffect(() => {
    const page = `${tab.tabId}|${tab.url}`;
    if (page !== lastPage.current) setJob(null);
    lastPage.current = page;
    if (!tab.tabId || !/^(https?|file):/.test(tab.url)) return setIsDetecting(false);
    const tabId = tab.tabId;
    let isCurrent = true;
    setIsDetecting(true);
    const timer = setTimeout(async () => {
      let found: JobPosting | null = null;
      for (let attempt = 0; attempt <= maxRetries && isCurrent && !found; attempt++) {
        if (attempt > 0) await sleep(retryDelayMs);
        if (isCurrent) found = await extractJob(tabId);
      }
      if (!isCurrent) return;
      setJob(found);
      setIsDetecting(false);
    }, detectDelayMs);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [tab.tabId, tab.url, version]);
  return { job, isDetecting };
}

export function use(): ActiveJob {
  const { tab, version } = useTrackedTab();
  const detected = useDetectedJob(tab, version);
  let host = "";
  try {
    host = new URL(tab.url).host;
  } catch {}
  return { ...tab, host, ...detected };
}
