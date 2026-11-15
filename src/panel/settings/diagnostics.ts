import * as messages from "../../messages.ts";
import * as storage from "../../storage.ts";
import * as activeTab from "../job/activeTab.ts";

/** Copies the learning log so misses and corrections can be reviewed or used to improve the mapping rules. */
export async function copyFillLog(): Promise<string> {
  const log = await storage.get("fillLog");
  await navigator.clipboard.writeText(JSON.stringify(log, null, 1));
  return `Copied ${log.length} log entries.`;
}

/** Copies every scanned field of the current tab as JSON so a user can report what an unsupported form looks like. */
export async function copyFieldScan(): Promise<string> {
  const { tabId } = await activeTab.readCurrentTab();
  if (!tabId) throw new Error("No tab to scan.");
  const frameIds = await messages.listFrameIds(tabId);
  const fields = [];
  for (const frameId of frameIds) {
    const scanned = (await messages.sendToFrame(tabId, frameId, { type: "scanFields" })) ?? [];
    for (const field of scanned) fields.push({ ...field, frameId, options: field.options.slice(0, 15) });
  }
  const tab = await chrome.tabs.get(tabId);
  await navigator.clipboard.writeText(JSON.stringify({ url: tab.url, fields }, null, 1));
  return `Copied ${fields.length} fields from ${frameIds.length} frame(s).`;
}
