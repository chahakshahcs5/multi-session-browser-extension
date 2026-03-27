/** Shape of a single cookie entry stored in a session */
export interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'no_restriction' | 'lax' | 'strict' | 'unspecified';
  expirationDate?: number;
}

/** A saved session (account) for a site */
export interface Session {
  id: string;
  label: string;
  cookies: CookieEntry[];
  createdAt: number;
  updatedAt: number;
}

/** Per-site data: list of sessions + default session for new tabs */
export interface SiteData {
  sessions: Session[];
  defaultSessionId: string | null;
}

/** Top-level storage schema: hostname → SiteData */
export interface StorageSchema {
  [hostname: string]: SiteData;
}

/**
 * Tab-session mapping: tabId → hostname → sessionId
 * Stored in-memory in background, persisted to chrome.storage.local
 */
export type TabSessionMap = Record<number, Record<string, string>>;

// ─── Message types for popup ↔ background communication ───

export type MessageType =
  | 'GET_ACTIVE_TAB'
  | 'CAPTURE_CURRENT'
  | 'SWITCH_SESSION'
  | 'CLEAR_COOKIES'
  | 'GET_TAB_SESSION'
  | 'SET_TAB_SESSION'
  | 'SET_DEFAULT_SESSION';

export interface GetActiveTabMessage {
  type: 'GET_ACTIVE_TAB';
}

export interface CaptureCurrentMessage {
  type: 'CAPTURE_CURRENT';
  hostname: string;
  tabId: number;
}

export interface SwitchSessionMessage {
  type: 'SWITCH_SESSION';
  hostname: string;
  cookies: CookieEntry[];
  tabId: number;
  sessionId: string;
}

export interface ClearCookiesMessage {
  type: 'CLEAR_COOKIES';
  hostname: string;
}

export interface GetTabSessionMessage {
  type: 'GET_TAB_SESSION';
  tabId: number;
  hostname: string;
}

export interface SetTabSessionMessage {
  type: 'SET_TAB_SESSION';
  tabId: number;
  hostname: string;
  sessionId: string;
  cookies: CookieEntry[];
}

export interface SetDefaultSessionMessage {
  type: 'SET_DEFAULT_SESSION';
  hostname: string;
  sessionId: string;
}

export type ExtensionMessage =
  | GetActiveTabMessage
  | CaptureCurrentMessage
  | SwitchSessionMessage
  | ClearCookiesMessage
  | GetTabSessionMessage
  | SetTabSessionMessage
  | SetDefaultSessionMessage;

export interface ActiveTabResponse {
  url: string;
  hostname: string;
  tabId: number;
}
