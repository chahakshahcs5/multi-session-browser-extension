import type { CookieEntry } from '../types';

/** sameSite type as chrome.cookies expects it */
type ChromeSameSite = `${chrome.cookies.SameSiteStatus}`;

/**
 * Resolve the cookie storeId for a given tab.
 * In incognito tabs, this returns the incognito store ID.
 * Falls back to '0' (the default store) if no match.
 */
export async function getStoreIdForTab(tabId: number): Promise<string> {
  try {
    const stores = await chrome.cookies.getAllCookieStores();
    for (const store of stores) {
      if (store.tabIds.includes(tabId)) {
        return store.id;
      }
    }
  } catch (err) {
    console.warn('Failed to resolve cookie store for tab:', err);
  }
  return '0'; // default store
}

/**
 * Capture all cookies for a given hostname from the browser.
 * Uses storeId to target the correct cookie store (normal vs incognito).
 */
export async function captureCookies(hostname: string, storeId?: string): Promise<CookieEntry[]> {
  const opts: chrome.cookies.GetAllDetails = { domain: hostname };
  if (storeId) opts.storeId = storeId;

  const cookies = await chrome.cookies.getAll(opts);

  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite as CookieEntry['sameSite'],
    expirationDate: c.expirationDate,
    hostOnly: c.hostOnly,
    partitionKey: c.partitionKey,
  }));
}

/**
 * Clear all cookies for a hostname, then set the given cookies.
 * Uses storeId to target the correct cookie store (normal vs incognito).
 */
export async function applyCookies(hostname: string, cookies: CookieEntry[], storeId?: string): Promise<void> {
  await clearCookies(hostname, storeId);

  for (const cookie of cookies) {
    const url = buildCookieUrl(cookie);

    try {
      const details: chrome.cookies.SetDetails = {
        url,
        name: cookie.name,
        value: cookie.value,
        path: cookie.path || "/",
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite as ChromeSameSite,
        storeId,
      };

      if (!cookie.hostOnly && cookie.domain) {
        details.domain = cookie.domain;
      }

      if (cookie.expirationDate) {
        details.expirationDate = cookie.expirationDate;
      }

      if ((cookie as any).partitionKey) {
        (details as any).partitionKey = (cookie as any).partitionKey;
      }

      await chrome.cookies.set(details);
    } catch (err) {
      console.warn(`Failed to set cookie "${cookie.name}" (${cookie.domain}${cookie.path}):`, err);
    }
  }
}

/**
 * Remove all cookies for a hostname.
 * Uses storeId to target the correct cookie store (normal vs incognito).
 */
export async function clearCookies(hostname: string, storeId?: string): Promise<void> {
  const opts: chrome.cookies.GetAllDetails = { domain: hostname };
  if (storeId) opts.storeId = storeId;

  const cookies = await chrome.cookies.getAll(opts);

  for (const cookie of cookies) {
    const url = `${cookie.secure ? 'https' : 'http'}://${cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain}${cookie.path}`;
    try {
      const removeDetails: { url: string; name: string; storeId?: string } = { url, name: cookie.name };
      if (storeId) removeDetails.storeId = storeId;
      await chrome.cookies.remove(removeDetails);
    } catch (err) {
      console.warn(`Failed to remove cookie "${cookie.name}":`, err);
    }
  }
}

/** Build a URL from a cookie's domain + path for chrome.cookies API */
function buildCookieUrl(cookie: Pick<CookieEntry, 'domain' | 'path' | 'secure'>): string {
  const protocol = cookie.secure ? 'https' : 'http';
  const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
  return `${protocol}://${domain}${cookie.path || '/'}`;
}
