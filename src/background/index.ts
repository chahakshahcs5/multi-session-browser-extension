import type { ExtensionMessage, ActiveTabResponse, SessionStorage, StorageStats } from '../types';
import { captureAllSessionData, getStorageStats } from '../services/storage-capture';
import { restoreAllSessionData, clearAllSessionData } from '../services/storage-restore';
import { getSiteData } from '../services/storage';
import {
  getTabSession,
  setTabSession,
  removeTab,
  cleanupStaleTabs,
} from '../services/tab-session-map';

console.log('Multi-Session Extension: background service worker started');

// ─── Lifecycle ───

chrome.runtime.onInstalled.addListener((details: any) => {
  console.log('Extension installed:', details.reason);
  cleanupStaleTabs();
});

// Clean up stale tabs when the service worker wakes up
cleanupStaleTabs();

// ─── Tab activation: swap session data when user focuses a tab ───

chrome.tabs.onActivated.addListener(async (activeInfo: any) => {
  try {
    await handleTabFocused(activeInfo.tabId);
  } catch (err) {
    console.error('Tab activation handler error:', err);
  }
});

// ─── Window focus: swap session data when user switches windows ───

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

// ─── Auto-sync: periodically capture storage changes ───

// Map to track last captured state per tab+hostname
const lastCapturedState = new Map<string, SessionStorage>();

// Poll for storage changes when a tab is active
let pollTimer: ReturnType<typeof setInterval> | null = null;

chrome.tabs.onActivated.addListener(() => {
  // Reset poll timer on tab activation
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    handleAutoSync();
  }, 3000); // Poll every 3 seconds
});

chrome.tabs.onRemoved.addListener(() => {
  if (pollTimer) clearInterval(pollTimer);
});

/**
 * Fast comparison of session storage data
 * Checks array lengths first before doing deep comparison
 */
function hasSessionStorageChanged(oldData: SessionStorage, newData: SessionStorage): boolean {
  // Quick length checks first (very fast)
  if (
    oldData.cookies.length !== newData.cookies.length ||
    oldData.localStorage.length !== newData.localStorage.length ||
    oldData.sessionStorage.length !== newData.sessionStorage.length ||
    oldData.indexedDB.length !== newData.indexedDB.length ||
    oldData.webSQL.length !== newData.webSQL.length
  ) {
    return true;
  }

  // Only do full JSON compare if lengths match (likely means data changed elsewhere)
  return JSON.stringify(newData) !== JSON.stringify(oldData);
}

async function handleAutoSync(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return;

    let hostname: string;
    try {
      hostname = new URL(tab.url).hostname;
    } catch {
      return;
    }

    const sessionId = await getTabSession(tab.id, hostname);
    if (!sessionId) return;

    // Get the session to check enabled storage types
    const siteData = await getSiteData(hostname);
    const session = siteData.sessions.find((s) => s.id === sessionId);
    if (!session) return;

    // Get enabled storage types for this session (default to all if not set)
    const enabledStorageTypes = session.enabledStorageTypes || {
      cookies: true,
      localStorage: true,
      sessionStorage: true,
      indexedDB: true,
      webSQL: true,
    };

    const storeId = await getStoreIdForTab(tab.id);
    const freshData = await captureAllSessionData(hostname, tab.id, storeId, enabledStorageTypes);
    
    const stateKey = `${tab.id}:${hostname}:${sessionId}`;
    const lastData = lastCapturedState.get(stateKey);

    // Fast comparison: check if anything changed
    if (lastData && hasSessionStorageChanged(lastData, freshData)) {
      const { updateSession: updateSessionFn } = await import('../services/storage');
      await updateSessionFn(hostname, sessionId, { sessionData: freshData });
      lastCapturedState.set(stateKey, freshData);
    } else if (!lastData) {
      // Initialize state tracking
      lastCapturedState.set(stateKey, freshData);
    }
  } catch (err) {
    console.error('Auto-sync handler error:', err);
  }
}

// ─── Helper: get store ID for tab ───

async function getStoreIdForTab(tabId: number): Promise<string> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.incognito ? 'firefox-private' : '0';
  } catch {
    return '0';
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

  // Tab is tracked → silently swap session data (no reload)
  const siteData = await getSiteData(hostname);
  const session = siteData.sessions.find((s) => s.id === sessionId);
  if (session) {
    await restoreAllSessionData(hostname, tabId, session.sessionData, storeId);
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
  await restoreAllSessionData(hostname, tabId, session.sessionData, storeId);
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
      return handleCaptureCurrent(message.hostname, message.tabId, message.enabledStorageTypes);

    case 'SWITCH_SESSION':
      return handleSwitchSession(message.hostname, message.sessionData, message.tabId, message.sessionId);

    case 'CLEAR_SESSION_DATA':
      return handleClearSessionData(message.hostname);

    case 'GET_TAB_SESSION':
      return handleGetTabSession(message.tabId, message.hostname);

    case 'SET_TAB_SESSION':
      return handleSetTabSession(message.tabId, message.hostname, message.sessionId, message.sessionData);

    case 'SET_DEFAULT_SESSION':
      return handleSetDefaultSession(message.hostname, message.sessionId);

    case 'GET_STORAGE_STATS':
      return handleGetStorageStats(message.hostname, message.tabId);

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

async function handleCaptureCurrent(hostname: string, tabId: number, enabledStorageTypes?: any): Promise<SessionStorage> {
  const storeId = await getStoreIdForTab(tabId);
  return captureAllSessionData(hostname, tabId, storeId, enabledStorageTypes);
}

async function handleSwitchSession(
  hostname: string,
  sessionData: SessionStorage,
  tabId: number,
  sessionId: string
): Promise<{ success: boolean }> {
  const storeId = await getStoreIdForTab(tabId);
  
  // Clear all session data first to ensure clean switch
  // (removes data from previous session that might not be in new session)
  await clearAllSessionData(hostname, tabId, storeId);
  
  // Map session to this tab
  await setTabSession(tabId, hostname, sessionId);
  
  // Restore only the new session's data
  await restoreAllSessionData(hostname, tabId, sessionData, storeId);
  await chrome.tabs.reload(tabId);
  return { success: true };
}

async function handleClearSessionData(hostname: string): Promise<{ success: boolean }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { success: false };
  }
  const storeId = await getStoreIdForTab(tab.id);
  await clearAllSessionData(hostname, tab.id, storeId);
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
  sessionData: SessionStorage
): Promise<{ success: boolean }> {
  const storeId = await getStoreIdForTab(tabId);
  await setTabSession(tabId, hostname, sessionId);
  await restoreAllSessionData(hostname, tabId, sessionData, storeId);
  await chrome.tabs.reload(tabId);
  return { success: true };
}

async function handleSetDefaultSession(
  hostname: string,
  sessionId: string | null
): Promise<{ success: boolean }> {
  const { setDefaultSession } = await import('../services/storage');
  await setDefaultSession(hostname, sessionId);
  return { success: true };
}

async function handleGetStorageStats(hostname: string, tabId: number): Promise<StorageStats> {
  const storeId = await getStoreIdForTab(tabId);
  const sessionData = await captureAllSessionData(hostname, tabId, storeId);
  return getStorageStats(sessionData);
}
