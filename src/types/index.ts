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
  hostOnly?: boolean;
  partitionKey?: chrome.cookies.CookiePartitionKey;
}

/** Shape of a key-value storage entry (localStorage, sessionStorage) */
export interface StorageEntry {
  key: string;
  value: string;
  domain: string;
}

/** Shape of an IndexedDB entry within a store */
export interface IndexedDBRecord {
  [key: string]: any;
}

/** Shape of an IndexedDB store with its entries */
export interface IndexedDBStore {
  name: string;
  entries: IndexedDBRecord[];
}

/** Shape of an IndexedDB database with its stores */
export interface IndexedDBEntry {
  database: string;
  domain: string;
  stores: IndexedDBStore[];
}

/** Shape of a WebSQL table with its entries */
export interface WebSQLTable {
  name: string;
  columns: string[];
  entries: any[];
}

/** Shape of a WebSQL database with its tables */
export interface WebSQLEntry {
  database: string;
  domain: string;
  tables: WebSQLTable[];
}

/** Shape of a FileSystem API entry (cache/data) */
export interface FileSystemEntry {
  path: string;
  domain: string;
  data: string;
  size: number;
}

/** Complete session data including all storage types */
export interface SessionStorage {
  cookies: CookieEntry[];
  localStorage: StorageEntry[];
  sessionStorage: StorageEntry[];
  indexedDB: IndexedDBEntry[];
  webSQL: WebSQLEntry[];
  fileSystem: FileSystemEntry[];
}

/** A saved session (account) for a site */
export interface Session {
  id: string;
  label: string;
  /** Main session data containing all storage types */
  sessionData: SessionStorage;
  /** Legacy field for backward compatibility - will be auto-migrated */
  cookies?: CookieEntry[];
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

export type MessageType =
  | 'GET_ACTIVE_TAB'
  | 'CAPTURE_CURRENT'
  | 'SWITCH_SESSION'
  | 'CLEAR_SESSION_DATA'
  | 'GET_TAB_SESSION'
  | 'SET_TAB_SESSION'
  | 'SET_DEFAULT_SESSION'
  | 'GET_STORAGE_STATS';

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
  sessionData: SessionStorage;
  tabId: number;
  sessionId: string;
}

export interface ClearSessionDataMessage {
  type: 'CLEAR_SESSION_DATA';
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
  sessionData: SessionStorage;
}

export interface SetDefaultSessionMessage {
  type: 'SET_DEFAULT_SESSION';
  hostname: string;
  sessionId: string;
}

export interface GetStorageStatsMessage {
  type: 'GET_STORAGE_STATS';
  hostname: string;
  tabId: number;
}

export type ExtensionMessage =
  | GetActiveTabMessage
  | CaptureCurrentMessage
  | SwitchSessionMessage
  | ClearSessionDataMessage
  | GetTabSessionMessage
  | SetTabSessionMessage
  | SetDefaultSessionMessage
  | GetStorageStatsMessage;

export interface StorageStats {
  cookies: number;
  localStorage: number;
  sessionStorage: number;
  indexedDB: number;
  webSQL: number;
  fileSystem: number;
  totalSize: number;
}

export interface ActiveTabResponse {
  url: string;
  hostname: string;
  tabId: number;
}
