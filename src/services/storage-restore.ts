/**
 * Storage Restore Service
 * Handles restoring all types of session storage (cookies, localStorage, sessionStorage, IndexedDB, WebSQL)
 */

import type {
  CookieEntry,
  SessionStorage,
  StorageEntry,
} from '../types/index';

/**
 * Build a URL for cookie operations (protocol://domain/path)
 */
function buildCookieUrl(domain: string, path: string = '/'): string {
  const protocol = 'https';
  // Remove leading dot for cookie URL (Chrome requires it without dot)
  const cleanDomain = domain.startsWith('.') ? domain.slice(1) : domain;
  return `${protocol}://${cleanDomain}${path}`;
}

/**
 * Clear all cookies for a given domain
 */
export async function clearCookies(hostname: string, storeId?: string): Promise<void> {
  try {
    const cookies = await chrome.cookies.getAll({
      domain: hostname,
      storeId,
    });

    // Delete each cookie
    const deletePromises = cookies.map((cookie: any) => {
      const url = buildCookieUrl(cookie.domain, cookie.path);
      return chrome.cookies.remove({
        url,
        name: cookie.name,
        storeId: cookie.storeId,
      });
    });

    await Promise.all(deletePromises);
  } catch (error) {
    console.error(`[MultiSession] Failed to clear cookies for ${hostname}:`, error);
  }
}

/**
 * Apply (set) cookies from a captured session
 * Clears existing cookies before setting new ones
 */
export async function applyCookies(
  hostname: string,
  cookies: CookieEntry[],
  storeId?: string
): Promise<void> {
  try {
    // Clear existing cookies first
    await clearCookies(hostname, storeId);

    // Set each cookie from the session
    const setPromises = cookies.map(cookie => {
      const cookieDetails: any = {
        url: buildCookieUrl(cookie.domain, cookie.path),
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expirationDate: cookie.expirationDate,
        storeId,
      };

      return chrome.cookies.set(cookieDetails).catch((error: any) => {
        console.warn(`[MultiSession] Failed to set cookie ${cookie.name}:`, error);
      });
    });

    await Promise.all(setPromises);
  } catch (error) {
    console.error(`[MultiSession] Failed to apply cookies for ${hostname}:`, error);
  }
}

/**
 * Restore client-side storage (localStorage, sessionStorage) via content script
 */
async function restoreClientStorage(
  tabId: number,
  storage: {
    localStorage?: StorageEntry[];
    sessionStorage?: StorageEntry[];
  },
  clearFirst: boolean = true
): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'RESTORE_STORAGE',
      data: storage,
      clearFirst,
    });

    return response?.success ?? false;
  } catch (error) {
    console.warn(
      `[MultiSession] Failed to restore client-side storage to tab ${tabId}:`,
      error
    );
    return false;
  }
}

/**
 * Clear client-side storage via content script
 */
async function clearClientStorage(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'CLEAR_STORAGE',
    });

    return response?.success ?? false;
  } catch (error) {
    console.warn(
      `[MultiSession] Failed to clear client-side storage on tab ${tabId}:`,
      error
    );
    return false;
  }
}

/**
 * Restore ALL session data (cookies + client-side storage) IN PARALLEL
 */
export async function restoreAllSessionData(
  hostname: string,
  tabId: number,
  sessionData: SessionStorage,
  storeId?: string
): Promise<void> {
  try {
    // Restore cookies AND client-side storage in PARALLEL
    const [, clientStorageRestored] = await Promise.all([
      applyCookies(hostname, sessionData.cookies, storeId),
      restoreClientStorage(
        tabId,
        {
          localStorage: sessionData.localStorage,
          sessionStorage: sessionData.sessionStorage,
        },
        true
      ),
    ]);

    if (!clientStorageRestored) {
      console.warn(
        `[MultiSession] Failed to restore client-side storage for ${hostname}`
      );
    }

    // TODO: Restore IndexedDB and WebSQL once implementation is complete
    // if (sessionData.indexedDB && sessionData.indexedDB.length > 0) {
    //   await restoreIndexedDB(tabId, sessionData.indexedDB);
    // }
    // if (sessionData.webSQL && sessionData.webSQL.length > 0) {
    //   await restoreWebSQL(tabId, sessionData.webSQL);
    // }
  } catch (error) {
    console.error(
      `[MultiSession] Failed to restore all session data for ${hostname}:`,
      error
    );
  }
}

/**
 * Clear ALL session data (cookies + client-side storage)
 */
export async function clearAllSessionData(
  hostname: string,
  tabId: number,
  storeId?: string
): Promise<void> {
  try {
    // Clear cookies first
    await clearCookies(hostname, storeId);

    // Clear client-side storage via content script
    await clearClientStorage(tabId);

    // TODO: Clear IndexedDB and WebSQL data
  } catch (error) {
    console.error(
      `[MultiSession] Failed to clear all session data for ${hostname}:`,
      error
    );
  }
}

export default {
  clearCookies,
  applyCookies,
  restoreAllSessionData,
  clearAllSessionData,
};
