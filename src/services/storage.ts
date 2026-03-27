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
  const raw = all[hostname] || { sessions: [], defaultSessionId: null };

  // Migrate legacy data: rename activeSessionId → defaultSessionId
  if ('activeSessionId' in raw && !('defaultSessionId' in raw)) {
    (raw as SiteData).defaultSessionId = (raw as Record<string, unknown>).activeSessionId as string | null;
    delete (raw as Record<string, unknown>).activeSessionId;
  }

  // Auto-set default if exactly 1 session and no default set
  if (raw.sessions.length === 1 && !raw.defaultSessionId) {
    raw.defaultSessionId = raw.sessions[0].id;
  }

  return raw;
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

  // Auto-set default if this is the first/only session
  if (siteData.sessions.length === 1) {
    siteData.defaultSessionId = session.id;
  }

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

  // Clear default if the deleted session was the default
  if (siteData.defaultSessionId === sessionId) {
    // Auto-set to the remaining session if exactly 1 left, else null
    siteData.defaultSessionId = siteData.sessions.length === 1 ? siteData.sessions[0].id : null;
  }

  await saveSiteData(hostname, siteData);
  return true;
}

/** Mark a session as the default one for new tabs */
export async function setDefaultSession(
  hostname: string,
  sessionId: string | null
): Promise<void> {
  const siteData = await getSiteData(hostname);
  siteData.defaultSessionId = sessionId;
  await saveSiteData(hostname, siteData);
}

/** Get all hostnames that have stored sessions */
export async function getAllSites(): Promise<string[]> {
  const all = await getAllData();
  return Object.keys(all);
}
