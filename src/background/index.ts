import type { ExtensionMessage, ActiveTabResponse, CookieEntry } from '../types';
import { captureCookies, applyCookies, clearCookies, getStoreIdForTab } from '../services/cookies';
import { getSiteData } from '../services/storage';
import {
  getTabSession,
  setTabSession,
  removeTab,
  cleanupStaleTabs,
} from '../services/tab-session-map';

console.log('Multi-Session Extension: background service worker started');

// ─── Lifecycle ───

chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed:', details.reason);
  cleanupStaleTabs();
});

// Clean up stale tabs when the service worker wakes up
cleanupStaleTabs();

// ─── Tab activation: swap cookies when user focuses a tab ───

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    await handleTabFocused(activeInfo.tabId);
  } catch (err) {
    console.error('Tab activation handler error:', err);
  }
});

// ─── Window focus: swap cookies when user switches windows ───

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab?.id) {
      await handleTabFocused(tab.id);
    }
  } catch (err) {
    console.error('Window focus handler error:', err);
  }
});

// ─── Tab navigation: assign default session when a tab navigates to a new URL ───

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only act when navigation completes
  if (changeInfo.status !== 'complete' || !tab.url) return;

  try {
    const url = new URL(tab.url);
    const hostname = url.hostname;
    if (!hostname || hostname === 'newtab' || url.protocol === 'chrome:') return;

    const existingSession = await getTabSession(tabId, hostname);
    if (!existingSession) {
      // New/untracked tab → assign default session
      const storeId = await getStoreIdForTab(tabId);
      await assignDefaultSession(tabId, hostname, storeId);
    }
  } catch (err) {
    console.error('Tab updated handler error:', err);
  }
});

// ─── Tab removed: cleanup ───

chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    await removeTab(tabId);
  } catch (err) {
    console.error('Tab removal cleanup error:', err);
  }
});

// ─── Cookie change: update stored session when cookies change externally ───

let cookieChangeTimer: ReturnType<typeof setTimeout> | null = null;

chrome.cookies.onChanged.addListener((changeInfo) => {
  // Debounce — cookies often change in batches
  if (cookieChangeTimer) clearTimeout(cookieChangeTimer);
  cookieChangeTimer = setTimeout(() => {
    handleCookieChange(changeInfo.cookie.domain);
  }, 500);
});

async function handleCookieChange(changedDomain: string): Promise<void> {
  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return;

    let hostname: string;
    try {
      hostname = new URL(tab.url).hostname;
    } catch {
      return;
    }

    // Only act if the changed domain matches the active tab's hostname
    const normalizedDomain = changedDomain.startsWith('.') ? changedDomain.substring(1) : changedDomain;
    if (!hostname.endsWith(normalizedDomain) && normalizedDomain !== hostname) return;

    // Check if this tab has a mapped session
    const sessionId = await getTabSession(tab.id, hostname);
    if (!sessionId) return;

    // Capture the current cookies and update the stored session
    const storeId = await getStoreIdForTab(tab.id);
    const currentCookies = await captureCookies(hostname, storeId);
    const { updateSession } = await import('../services/storage');
    await updateSession(hostname, sessionId, { cookies: currentCookies });
  } catch (err) {
    console.error('Cookie change handler error:', err);
  }
}

// ─── Core: handle tab gaining focus ───

async function handleTabFocused(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) return;

  let hostname: string;
  try {
    const url = new URL(tab.url);
    hostname = url.hostname;
    if (!hostname || hostname === 'newtab' || url.protocol === 'chrome:' || url.protocol === 'chrome-extension:') return;
  } catch {
    return;
  }

  const storeId = await getStoreIdForTab(tabId);
  let sessionId = await getTabSession(tabId, hostname);

  if (!sessionId) {
    // Untracked tab → assign default session and reload
    sessionId = await assignDefaultSession(tabId, hostname, storeId);
    if (sessionId) {
      await chrome.tabs.reload(tabId);
    }
    return;
  }

  // Tab is tracked → silently swap cookies (no reload)
  const siteData = await getSiteData(hostname);
  const session = siteData.sessions.find((s) => s.id === sessionId);
  if (session) {
    await applyCookies(hostname, session.cookies, storeId);
  } else {
    // Mapped session no longer exists → fall back to default
    const fallbackId = await assignDefaultSession(tabId, hostname, storeId);
    if (fallbackId) {
      await chrome.tabs.reload(tabId);
    }
  }
}

/**
 * Assign the default session for a hostname to a tab.
 * Returns the sessionId that was assigned, or null if no default/sessions exist.
 */
async function assignDefaultSession(tabId: number, hostname: string, storeId: string): Promise<string | null> {
  const siteData = await getSiteData(hostname);

  // Determine which session to use as default
  let sessionId = siteData.defaultSessionId;

  // If no explicit default but exactly 1 session, use it
  if (!sessionId && siteData.sessions.length === 1) {
    sessionId = siteData.sessions[0].id;
  }

  if (!sessionId) return null;

  const session = siteData.sessions.find((s) => s.id === sessionId);
  if (!session) return null;

  await setTabSession(tabId, hostname, sessionId);
  await applyCookies(hostname, session.cookies, storeId);
  return sessionId;
}

// ─── Message handler ───

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((err) => {
        console.error('Background message handler error:', err);
        sendResponse({ error: String(err) });
      });

    // Return true to indicate async response
    return true;
  }
);

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'GET_ACTIVE_TAB':
      return handleGetActiveTab();

    case 'CAPTURE_CURRENT':
      return handleCaptureCurrent(message.hostname, message.tabId);

    case 'SWITCH_SESSION':
      return handleSwitchSession(message.hostname, message.cookies, message.tabId, message.sessionId);

    case 'CLEAR_COOKIES':
      await clearCookies(message.hostname);
      return { success: true };

    case 'GET_TAB_SESSION':
      return handleGetTabSession(message.tabId, message.hostname);

    case 'SET_TAB_SESSION':
      return handleSetTabSession(message.tabId, message.hostname, message.sessionId, message.cookies);

    case 'SET_DEFAULT_SESSION':
      return handleSetDefaultSession(message.hostname, message.sessionId);

    default:
      return { error: 'Unknown message type' };
  }
}

async function handleGetActiveTab(): Promise<ActiveTabResponse | { error: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    return { error: 'No active tab found or URL is not accessible' };
  }
  try {
    const url = new URL(tab.url);
    return {
      url: tab.url,
      hostname: url.hostname,
      tabId: tab.id!,
    };
  } catch {
    return { error: 'Cannot parse tab URL' };
  }
}

async function handleCaptureCurrent(hostname: string, tabId: number): Promise<CookieEntry[]> {
  const storeId = await getStoreIdForTab(tabId);
  return captureCookies(hostname, storeId);
}

async function handleSwitchSession(
  hostname: string,
  cookies: CookieEntry[],
  tabId: number,
  sessionId: string
): Promise<{ success: boolean }> {
  const storeId = await getStoreIdForTab(tabId);
  // Map session to this tab
  await setTabSession(tabId, hostname, sessionId);
  // Apply cookies and reload
  await applyCookies(hostname, cookies, storeId);
  await chrome.tabs.reload(tabId);
  return { success: true };
}

async function handleGetTabSession(
  tabId: number,
  hostname: string
): Promise<{ sessionId: string | null }> {
  const sessionId = await getTabSession(tabId, hostname);
  return { sessionId };
}

async function handleSetTabSession(
  tabId: number,
  hostname: string,
  sessionId: string,
  cookies: CookieEntry[]
): Promise<{ success: boolean }> {
  const storeId = await getStoreIdForTab(tabId);
  await setTabSession(tabId, hostname, sessionId);
  await applyCookies(hostname, cookies, storeId);
  await chrome.tabs.reload(tabId);
  return { success: true };
}

async function handleSetDefaultSession(
  hostname: string,
  sessionId: string
): Promise<{ success: boolean }> {
  const { setDefaultSession } = await import('../services/storage');
  await setDefaultSession(hostname, sessionId);
  return { success: true };
}
