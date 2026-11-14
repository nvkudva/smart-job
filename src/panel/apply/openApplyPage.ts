import * as session from "../../fill/session.ts";
import type { ApplyClick } from "../../messages.ts";
import * as linkedinImport from "../../profile/linkedinImport.ts";
import * as selection from "../../superjob/selection.ts";
import type { JobPosting } from "../../types.ts";

const clickAttempts = 5;
const clickRetryMs = 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface OpenedApplyPage {
  /** the tab now showing the portal's apply page; undefined when the Apply control was a button clicked in place */
  portalTabId: number | undefined;
  click: ApplyClick;
}

/** The content script may not be listening yet right after a page loads, so a "none" is retried. */
async function clickWhenReady(tabId: number): Promise<ApplyClick> {
  let click: ApplyClick = { result: "none" };
  for (let attempt = 0; attempt < clickAttempts && click.result === "none"; attempt++) {
    if (attempt) await sleep(clickRetryMs);
    click = await session.clickApply(tabId);
  }
  return click;
}

/**
 * Takes the user to the page behind the portal's Apply control. From a Super Job tab the listing opens in a new tab first, then
 * that tab follows the Apply link; from a portal tab the link opens in a new tab. A button is clicked where it is.
 * Opened from the panel, not from the page: a click sent by the panel has no user activation, so a page-opened tab would be popup-blocked.
 */
export async function open(tabId: number, tabUrl: string, job: JobPosting | null): Promise<OpenedApplyPage> {
  if (job && selection.isPage(tabUrl)) {
    const listing = await chrome.tabs.create({ url: job.url, openerTabId: tabId });
    await linkedinImport.waitForLoad(listing.id!, false);
    const click = await clickWhenReady(listing.id!);
    if (click.result === "link") await chrome.tabs.update(listing.id!, { url: click.href });
    return { portalTabId: listing.id, click };
  }
  const click = await clickWhenReady(tabId);
  const opened = click.result === "link" ? await chrome.tabs.create({ url: click.href, openerTabId: tabId }) : undefined;
  return { portalTabId: opened?.id, click };
}
