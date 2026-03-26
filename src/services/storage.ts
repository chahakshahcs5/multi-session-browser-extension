import type { Session, SiteData } from '../types';

const STORAGE_KEY = 'multiSessionData';

/** Get all stored data keyed by hostname */
async function getAllData(): Promise<Record<string, SiteData>> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as Record<string, SiteData>) || {};
}

/** Persist all data */
async function saveAllData(data: Record<string, SiteData>): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

/** Get data for a specific site */
export async function getSiteData(hostname: string): Promise<SiteData> {
  const all = await getAllData();
  return all[hostname] || { sessions: [], activeSessionId: null };
}

/** Save data for a specific site */
export async function saveSiteData(hostname: string, siteData: SiteData): Promise<void> {
  const all = await getAllData();
  all[hostname] = siteData;
  await saveAllData(all);
}

/** Generate a unique ID */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

/** Add a new session for a site */
export async function addSession(
  hostname: string,
  label: string,
  cookies: Session['cookies']
): Promise<Session> {
  const siteData = await getSiteData(hostname);
  const now = Date.now();
  const session: Session = {
    id: generateId(),
    label,
    cookies,
    createdAt: now,
    updatedAt: now,
  };
  siteData.sessions.push(session);
  await saveSiteData(hostname, siteData);
  return session;
}

/** Update an existing session's label and/or cookies */
export async function updateSession(
  hostname: string,
  sessionId: string,
  updates: { label?: string; cookies?: Session['cookies'] }
): Promise<Session | null> {
  const siteData = await getSiteData(hostname);
  const session = siteData.sessions.find((s) => s.id === sessionId);
  if (!session) return null;

  if (updates.label !== undefined) session.label = updates.label;
  if (updates.cookies !== undefined) session.cookies = updates.cookies;
  session.updatedAt = Date.now();

  await saveSiteData(hostname, siteData);
  return session;
}

/** Delete a session */
export async function deleteSession(hostname: string, sessionId: string): Promise<boolean> {
  const siteData = await getSiteData(hostname);
  const idx = siteData.sessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return false;

  siteData.sessions.splice(idx, 1);
  if (siteData.activeSessionId === sessionId) {
    siteData.activeSessionId = null;
  }
  await saveSiteData(hostname, siteData);
  return true;
}

/** Mark a session as the active one for a site */
export async function setActiveSession(
  hostname: string,
  sessionId: string | null
): Promise<void> {
  const siteData = await getSiteData(hostname);
  siteData.activeSessionId = sessionId;
  await saveSiteData(hostname, siteData);
}

/** Get all hostnames that have stored sessions */
export async function getAllSites(): Promise<string[]> {
  const all = await getAllData();
  return Object.keys(all);
}
