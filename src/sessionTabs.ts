/** Per-tab values kept in session storage, one storage key per tab, so pages in different tabs never overwrite each other's entry. */
export type TabKey = "superjobSelection" | "uploadedResumePage";

const allKeys: TabKey[] = ["superjobSelection", "uploadedResumePage"];

const storageKeyOf = (key: TabKey, tabId: number) => `${key}:${tabId}`;

export const isKeyFor = (storageKey: string, key: TabKey) => storageKey.startsWith(`${key}:`);

export async function read<Value>(key: TabKey, tabId: number): Promise<Value | undefined> {
  const storageKey = storageKeyOf(key, tabId);
  const stored = await chrome.storage.session?.get(storageKey);
  return stored?.[storageKey] as Value | undefined;
}

export async function write<Value>(key: TabKey, tabId: number, value: Value): Promise<void> {
  await chrome.storage.session?.set({ [storageKeyOf(key, tabId)]: value });
}

/** Drops a closed tab's entries so session storage does not keep every job description it ever showed. */
export async function forget(tabId: number): Promise<void> {
  await chrome.storage.session?.remove(allKeys.map((key) => storageKeyOf(key, tabId)));
}
