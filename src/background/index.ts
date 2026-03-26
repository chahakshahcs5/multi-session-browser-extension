import type { ExtensionMessage, ActiveTabResponse, CookieEntry } from '../types';
import { captureCookies, applyCookies, clearCookies } from '../services/cookies';

console.log('Multi-Session Extension: background service worker started');

chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed:', details.reason);
});

/**
 * Message handler for popup → background communication.
 */
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
      return handleCaptureCurrent(message.hostname);

    case 'SWITCH_SESSION':
      return handleSwitchSession(message.hostname, message.cookies, message.tabId);

    case 'CLEAR_COOKIES':
      await clearCookies(message.hostname);
      return { success: true };

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

async function handleCaptureCurrent(hostname: string): Promise<CookieEntry[]> {
  return captureCookies(hostname);
}

async function handleSwitchSession(
  hostname: string,
  cookies: CookieEntry[],
  tabId: number
): Promise<{ success: boolean }> {
  await applyCookies(hostname, cookies);
  // Reload the tab to apply new cookies
  await chrome.tabs.reload(tabId);
  return { success: true };
}
