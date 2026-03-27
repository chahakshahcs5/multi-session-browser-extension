/**
 * Tab-Session mapping service.
 *
 * Maintains an in-memory map of tabId → hostname → sessionId.
 * Persisted to chrome.storage.local so it survives service-worker restarts.
 */

const STORAGE_KEY = 'tabSessionMap';

/** In-memory map: tabId → { hostname → sessionId } */
let tabMap = new Map<number, Map<string, string>>();

/** Whether we've loaded from storage yet */
let loaded = false;

/** Load persisted map from chrome.storage.local */
async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const raw = result[STORAGE_KEY] as Record<number, Record<string, string>> | undefined;
  if (raw) {
    for (const [tabId, hostMap] of Object.entries(raw)) {
      const inner = new Map<string, string>();
      for (const [host, sessionId] of Object.entries(hostMap)) {
        inner.set(host, sessionId);
      }
      tabMap.set(Number(tabId), inner);
    }
  }
  loaded = true;
}

/** Persist in-memory map to storage */
async function persist(): Promise<void> {
  const obj: Record<number, Record<string, string>> = {};
  for (const [tabId, hostMap] of tabMap) {
    const inner: Record<string, string> = {};
    for (const [host, sessionId] of hostMap) {
      inner[host] = sessionId;
    }
    obj[tabId] = inner;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: obj });
}

/** Get the session mapped to a specific tab+hostname */
export async function getTabSession(tabId: number, hostname: string): Promise<string | null> {
  await ensureLoaded();
  return tabMap.get(tabId)?.get(hostname) ?? null;
}

/** Set the session for a specific tab+hostname */
export async function setTabSession(tabId: number, hostname: string, sessionId: string): Promise<void> {
  await ensureLoaded();
  if (!tabMap.has(tabId)) {
    tabMap.set(tabId, new Map());
  }
  tabMap.get(tabId)!.set(hostname, sessionId);
  await persist();
}

/** Remove all session mappings for a tab (called on tab close) */
export async function removeTab(tabId: number): Promise<void> {
  await ensureLoaded();
  tabMap.delete(tabId);
  await persist();
}

/** Get all tab sessions (for debugging / popup display) */
export async function getAllTabSessions(): Promise<Map<number, Map<string, string>>> {
  await ensureLoaded();
  return tabMap;
}

/** Clean up stale tabs that no longer exist */
export async function cleanupStaleTabs(): Promise<void> {
  await ensureLoaded();
  const openTabs = await chrome.tabs.query({});
  const openTabIds = new Set(openTabs.map((t) => t.id).filter(Boolean));
  let changed = false;
  for (const tabId of tabMap.keys()) {
    if (!openTabIds.has(tabId)) {
      tabMap.delete(tabId);
      changed = true;
    }
  }
  if (changed) await persist();
}
