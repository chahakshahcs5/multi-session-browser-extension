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

/** Per-site data: list of sessions + which one is active */
export interface SiteData {
  sessions: Session[];
  activeSessionId: string | null;
}

/** Top-level storage schema: hostname → SiteData */
export interface StorageSchema {
  [hostname: string]: SiteData;
}

// ─── Message types for popup ↔ background communication ───

export type MessageType =
  | 'GET_ACTIVE_TAB'
  | 'CAPTURE_CURRENT'
  | 'SWITCH_SESSION'
  | 'CLEAR_COOKIES';

export interface GetActiveTabMessage {
  type: 'GET_ACTIVE_TAB';
}

export interface CaptureCurrentMessage {
  type: 'CAPTURE_CURRENT';
  hostname: string;
}

export interface SwitchSessionMessage {
  type: 'SWITCH_SESSION';
  hostname: string;
  cookies: CookieEntry[];
  tabId: number;
}

export interface ClearCookiesMessage {
  type: 'CLEAR_COOKIES';
  hostname: string;
}

export type ExtensionMessage =
  | GetActiveTabMessage
  | CaptureCurrentMessage
  | SwitchSessionMessage
  | ClearCookiesMessage;

export interface ActiveTabResponse {
  url: string;
  hostname: string;
  tabId: number;
}
