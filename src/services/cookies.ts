import type { CookieEntry } from '../types';

/** sameSite type as chrome.cookies expects it */
type ChromeSameSite = `${chrome.cookies.SameSiteStatus}`;

/**
 * Capture all cookies for a given hostname from the browser.
 */
export async function captureCookies(hostname: string): Promise<CookieEntry[]> {
  const cookies = await chrome.cookies.getAll({ domain: hostname });

  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite as CookieEntry['sameSite'],
    expirationDate: c.expirationDate,
  }));
}

/**
 * Clear all cookies for a hostname, then set the given cookies.
 */
export async function applyCookies(hostname: string, cookies: CookieEntry[]): Promise<void> {
  await clearCookies(hostname);

  for (const cookie of cookies) {
    const url = buildCookieUrl(cookie);
    try {
      await chrome.cookies.set({
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite as ChromeSameSite,
        expirationDate: cookie.expirationDate,
      });
    } catch (err) {
      console.warn(`Failed to set cookie "${cookie.name}":`, err);
    }
  }
}

/**
 * Remove all cookies for a hostname.
 */
export async function clearCookies(hostname: string): Promise<void> {
  const cookies = await chrome.cookies.getAll({ domain: hostname });

  for (const cookie of cookies) {
    const url = `${cookie.secure ? 'https' : 'http'}://${cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain}${cookie.path}`;
    try {
      await chrome.cookies.remove({ url, name: cookie.name });
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
