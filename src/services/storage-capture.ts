/**
 * Storage Capture Service
 * Handles capturing all types of session storage (cookies, localStorage, sessionStorage, IndexedDB, WebSQL)
 */

import type {
  CookieEntry,
  SessionStorage,
  StorageEntry,
  IndexedDBEntry,
  WebSQLEntry,
} from '../types/index';

/**
 * Get parent domain levels for a hostname (limited to prevent capturing unrelated cookies)
 * Only queries the hostname + 1 level of parent domain
 * Example: "dash.cloudflare.com" → ["dash.cloudflare.com", ".cloudflare.com"] (not .com!)
 * Example: "api.example.co.uk" → ["api.example.co.uk", ".example.co.uk"]
 * Example: "localhost" → ["localhost"]
 */
function getParentDomains(hostname: string): string[] {
  const domains: string[] = [];

  // Handle localhost and IP addresses (return as-is)
  if (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return [hostname];
  }

  const parts = hostname.split('.');

  // Limit: only query hostname + 1 parent level
  // This prevents querying '.com', '.uk', etc. which would get unrelated cookies
  if (parts.length >= 2) {
    // Add 1 level of parent domain (with leading dot)
    domains.push('.' + parts.slice(-2).join('.'));
  }

  // Add the full hostname itself
  domains.push(hostname);

  return domains;
}

/**
 * Capture all cookies for a given domain, parent domains, and additional related domains
 */
export async function captureCookies(
  hostname: string,
  storeId?: string,
  additionalDomains?: string[]
): Promise<CookieEntry[]> {
  try {
    const parentDomains = getParentDomains(hostname);
    const domainsToQuery = new Set<string>();

    // Add parent domains
    parentDomains.forEach((d) => domainsToQuery.add(d));

    // Add discovered domains from the page
    if (Array.isArray(additionalDomains)) {
      additionalDomains.forEach((d) => {
        if (d && typeof d === 'string') {
          domainsToQuery.add(d);
          // Also add 1 level of parent for discovered domains (e.g., .stripe.com for js.stripe.com)
          const parts = d.split('.');
          if (parts.length >= 2) {
            domainsToQuery.add('.' + parts.slice(-2).join('.'));
          }
        }
      });
    }

    const allCookies: CookieEntry[] = [];
    const seenCookies = new Set<string>(); // Deduplicate: "name|domain|path"

    // Query cookies from ALL domains in PARALLEL
    const cookiePromises = Array.from(domainsToQuery).map((domain) =>
      chrome.cookies
        .getAll({ domain, storeId })
        .catch((err) => {
          console.warn(
            `[MultiSession] Failed to capture cookies for domain ${domain}:`,
            err
          );
          return [];
        })
    );

    const allDomainCookies = await Promise.all(cookiePromises);

    // Merge and deduplicate all cookies
    allDomainCookies.forEach((cookies) => {
      cookies.forEach((cookie: any) => {
        const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
        if (!seenCookies.has(key)) {
          seenCookies.add(key);
          allCookies.push({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: (cookie.sameSite as any) || 'lax',
            expirationDate: cookie.expirationDate,
            hostOnly: cookie.hostOnly,
            partitionKey: cookie.partitionKey,
          });
        }
      });
    });

    return allCookies;
  } catch (error) {
    console.error(`[MultiSession] Failed to capture cookies for ${hostname}:`, error);
    return [];
  }
}

/**
 * Get store ID for a given tab (normal or incognito)
 */
export async function getStoreIdForTab(tabId: number): Promise<string> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.incognito ? 'firefox-private' : '0';
  } catch (error) {
    return '0';
  }
}

/**
 * Capture client-side storage (localStorage, sessionStorage, IndexedDB, WebSQL) via content script
 * Now sends message to ALL frames in the tab to collect storage from subframes
 * Also returns the list of domains found on the page
 */
async function captureClientStorage(
  tabId: number
): Promise<{
  localStorage: StorageEntry[];
  sessionStorage: StorageEntry[];
  indexedDB: IndexedDBEntry[];
  webSQL: WebSQLEntry[];
  domains: string[];
}> {
  const allData = {
    localStorage: [] as StorageEntry[],
    sessionStorage: [] as StorageEntry[],
    indexedDB: [] as IndexedDBEntry[],
    webSQL: [] as WebSQLEntry[],
    domains: [] as string[],
  };

  try {
    // Get all frames in the tab
    let frames: Array<{ frameId: number }> = [{ frameId: 0 }]; // Default: main frame

    try {
      if (chrome.webNavigation?.getAllFrames) {
        const allFrames = await chrome.webNavigation.getAllFrames({ tabId });
        frames = allFrames || [{ frameId: 0 }];
      }
    } catch (err) {
      console.warn('[MultiSession] Failed to get all frames, using main frame only', err);
      frames = [{ frameId: 0 }];
    }

    const seenKeys = new Set<string>();
    const domainSet = new Set<string>();

    // Send CAPTURE_STORAGE to ALL frames in PARALLEL
    const framePromises = frames.map((frame) =>
      chrome.tabs
        .sendMessage(tabId, { type: 'CAPTURE_STORAGE' }, { frameId: frame.frameId })
        .catch((err) => {
          console.debug(`[MultiSession] Failed to capture from frame ${frame.frameId}:`, err);
          return null;
        })
    );

    const frameResponses = await Promise.all(framePromises);

    // Process all responses
    frameResponses.forEach((response) => {
      if (!response?.success || !response.data) return;

      const { localStorage, sessionStorage, indexedDB, webSQL } = response.data;

      // Deduplicate by domain:key
      if (Array.isArray(localStorage)) {
        localStorage.forEach((item: any) => {
          const key = `${item.domain}:${item.key}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            allData.localStorage.push(item);
            domainSet.add(item.domain);
          }
        });
      }

      if (Array.isArray(sessionStorage)) {
        sessionStorage.forEach((item: any) => {
          const key = `${item.domain}:${item.key}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            allData.sessionStorage.push(item);
            domainSet.add(item.domain);
          }
        });
      }

      if (Array.isArray(indexedDB)) {
        allData.indexedDB.push(...indexedDB);
      }

      if (Array.isArray(webSQL)) {
        allData.webSQL.push(...webSQL);
      }

      // Collect page domains from content script
      if (Array.isArray(response.domains)) {
        response.domains.forEach((d: string) => domainSet.add(d));
      }
    });

    allData.domains = Array.from(domainSet);
    return allData;
  } catch (error) {
    console.warn(
      `[MultiSession] Failed to capture client-side storage from tab ${tabId}:`,
      error
    );
    return {
      localStorage: [],
      sessionStorage: [],
      indexedDB: [],
      webSQL: [],
      domains: [],
    };
  }
}

/**
 * Capture ALL session data for a domain (cookies + client-side storage)
 */
export async function captureAllSessionData(
  hostname: string,
  tabId: number,
  storeId?: string,
  enabledStorageTypes?: any
): Promise<SessionStorage> {
  // Default to capturing all types if not specified
  const captureConfig = {
    cookies: true,
    localStorage: true,
    sessionStorage: true,
    indexedDB: true,
    webSQL: true,
    ...enabledStorageTypes,
  };

  // First get client storage to discover all domains on the page
  const clientStorage = await captureClientStorage(tabId);

  // Then capture cookies for the main hostname + discovered domains
  const cookies = captureConfig.cookies ? await captureCookies(hostname, storeId, clientStorage.domains) : [];

  return {
    cookies,
    localStorage: captureConfig.localStorage ? clientStorage.localStorage : [],
    sessionStorage: captureConfig.sessionStorage ? clientStorage.sessionStorage : [],
    indexedDB: captureConfig.indexedDB ? clientStorage.indexedDB : [],
    webSQL: captureConfig.webSQL ? clientStorage.webSQL : [],
    fileSystem: [], // FileSystem API support deferred for now
  };
}

/**
 * Get statistics about captured session storage
 */
export function getStorageStats(sessionData: SessionStorage) {
  return {
    cookies: sessionData.cookies.length,
    localStorage: sessionData.localStorage.length,
    sessionStorage: sessionData.sessionStorage.length,
    indexedDB: sessionData.indexedDB.reduce(
      (sum, db) =>
        sum +
        db.stores.reduce((storeSum, store) => storeSum + store.entries.length, 0),
      0
    ),
    webSQL: sessionData.webSQL.reduce(
      (sum, db) =>
        sum +
        db.tables.reduce((tableSum, table) => tableSum + table.entries.length, 0),
      0
    ),
    fileSystem: sessionData.fileSystem.length,
    totalSize: estimateSessionSize(sessionData),
  };
}

/**
 * Estimate total size of session data in bytes
 */
function estimateSessionSize(sessionData: SessionStorage): number {
  let size = 0;

  // Estimate cookies
  size += sessionData.cookies.reduce(
    (sum, cookie) => sum + (cookie.name.length + cookie.value.length),
    0
  );

  // Estimate localStorage
  size += sessionData.localStorage.reduce(
    (sum, entry) => sum + (entry.key.length + entry.value.length),
    0
  );

  // Estimate sessionStorage
  size += sessionData.sessionStorage.reduce(
    (sum, entry) => sum + (entry.key.length + entry.value.length),
    0
  );

  // Estimate IndexedDB (rough estimate based on JSON stringified data)
  size += sessionData.indexedDB.reduce(
    (sum, db) =>
      sum +
      db.stores.reduce(
        (storeSum, store) =>
          storeSum +
          store.entries.reduce(
            (entrySum, entry) => entrySum + JSON.stringify(entry).length,
            0
          ),
        0
      ),
    0
  );

  // Estimate WebSQL (rough estimate based on JSON stringified data)
  size += sessionData.webSQL.reduce(
    (sum, db) =>
      sum +
      db.tables.reduce(
        (tableSum, table) =>
          tableSum +
          table.entries.reduce(
            (entrySum, entry) => entrySum + JSON.stringify(entry).length,
            0
          ),
        0
      ),
    0
  );

  // Estimate FileSystem
  size += sessionData.fileSystem.reduce((sum, fs) => sum + fs.size, 0);

  return size;
}

/**
 * Merge two SessionStorage objects (for comparison/diff purposes)
 */
export function mergeSessionStorage(
  current: SessionStorage,
  updates: Partial<SessionStorage>
): SessionStorage {
  return {
    cookies: updates.cookies ?? current.cookies,
    localStorage: updates.localStorage ?? current.localStorage,
    sessionStorage: updates.sessionStorage ?? current.sessionStorage,
    indexedDB: updates.indexedDB ?? current.indexedDB,
    webSQL: updates.webSQL ?? current.webSQL,
    fileSystem: updates.fileSystem ?? current.fileSystem,
  };
}

/**
 * Check if two SessionStorage objects are different
 */
export function isSessionStorageChanged(
  stored: SessionStorage,
  fresh: SessionStorage
): boolean {
  // Simple JSON comparison (may need optimization for large data)
  return JSON.stringify(stored) !== JSON.stringify(fresh);
}

export default {
  captureCookies,
  captureAllSessionData,
  getStorageStats,
  mergeSessionStorage,
  isSessionStorageChanged,
};
