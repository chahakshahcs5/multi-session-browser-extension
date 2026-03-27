import type { CookieEntry, SiteData } from '../types';
import { getSiteData, addSession, updateSession, deleteSession, setDefaultSession, getAllSites } from '../services/storage';
import { parseCookieInput } from '../services/cookie-parser';

// ─── State ───
let allSitesData: Record<string, SiteData> = {};
/** Which site groups are collapsed (true = collapsed) */
const collapsedSites = new Set<string>();
let editingContext: { hostname: string; sessionId: string } | null = null;
let pendingDelete: { hostname: string; sessionId: string; label: string } | null = null;

// ─── DOM refs ───
const $loading = document.getElementById('loading')!;
const $emptyState = document.getElementById('empty-state')!;
const $sitesContainer = document.getElementById('sites-container')!;
const $searchInput = document.getElementById('search-input')! as HTMLInputElement;
const $btnTheme = document.getElementById('btn-theme')!;

const $modalOverlay = document.getElementById('modal-overlay')!;
const $modalTitle = document.getElementById('modal-title')!;
const $sessionForm = document.getElementById('session-form')! as HTMLFormElement;
const $inputLabel = document.getElementById('input-label')! as HTMLInputElement;
const $inputCookies = document.getElementById('input-cookies')! as HTMLTextAreaElement;
const $formError = document.getElementById('form-error')!;
const $btnCancel = document.getElementById('btn-cancel')!;
const $btnModalClose = document.getElementById('btn-modal-close')!;

const $deleteOverlay = document.getElementById('delete-overlay')!;
const $deleteLabel = document.getElementById('delete-label')!;
const $btnDeleteCancel = document.getElementById('btn-delete-cancel')!;
const $btnDeleteConfirm = document.getElementById('btn-delete-confirm')!;

const $toast = document.getElementById('toast')!;

// ─── Theme ───
const THEME_KEY = 'multiSessionTheme';

function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const theme = saved === 'light' ? 'light' : 'dark';
  applyTheme(theme);
}

function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.setAttribute('data-theme', theme);
  $btnTheme.textContent = theme === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

// ─── Toast ───
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string) {
  $toast.textContent = message;
  $toast.classList.remove('hidden');
  void $toast.offsetWidth;
  $toast.classList.add('show');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $toast.classList.remove('show');
    setTimeout(() => $toast.classList.add('hidden'), 250);
  }, 1500);
}

// ─── Init ───
init();

async function init() {
  loadTheme();
  await loadAllData();
}

async function loadAllData() {
  $loading.classList.remove('hidden');
  $emptyState.classList.add('hidden');
  $sitesContainer.classList.add('hidden');

  const hostnames = await getAllSites();

  allSitesData = {};
  for (const hostname of hostnames) {
    allSitesData[hostname] = await getSiteData(hostname);
  }

  renderAll();
  $loading.classList.add('hidden');
}

/**
 * Build the filtered view based on search input.
 *
 * Search rules:
 * - If query matches a hostname (case-insensitive) → show ALL sessions for that host
 * - If query matches a session label → show ONLY those matching sessions (across any host)
 * - If no query → show everything
 *
 * Returns: array of { hostname, sessions[] } to render
 */
function getFilteredData(): { hostname: string; sessions: SiteData['sessions'] }[] {
  const query = $searchInput.value.trim().toLowerCase();
  const allHosts = Object.keys(allSitesData).sort();

  if (!query) {
    return allHosts.map((h) => ({ hostname: h, sessions: allSitesData[h].sessions }));
  }

  const results: { hostname: string; sessions: SiteData['sessions'] }[] = [];

  for (const hostname of allHosts) {
    const siteData = allSitesData[hostname];

    // If hostname matches → show ALL sessions for it
    if (hostname.toLowerCase().includes(query)) {
      results.push({ hostname, sessions: siteData.sessions });
      continue;
    }

    // Otherwise check individual session labels
    const matchingSessions = siteData.sessions.filter((s) =>
      s.label.toLowerCase().includes(query)
    );
    if (matchingSessions.length > 0) {
      results.push({ hostname, sessions: matchingSessions });
    }
  }

  return results;
}

function renderAll() {
  const data = getFilteredData();

  if (data.length === 0) {
    $sitesContainer.classList.add('hidden');
    $emptyState.classList.remove('hidden');
    return;
  }

  $emptyState.classList.add('hidden');
  $sitesContainer.classList.remove('hidden');

  $sitesContainer.innerHTML = data
    .map(({ hostname, sessions }) => {
      const siteData = allSitesData[hostname];
      const isCollapsed = collapsedSites.has(hostname);
      const chevron = isCollapsed ? '▶' : '▼';

      const sessionCards = sessions.map((session) => {
        const isDefault = session.id === siteData.defaultSessionId;
        const cookieCount = session.cookies.length;
        const updatedAt = new Date(session.updatedAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

        return `
          <div class="session-card ${isDefault ? 'default' : ''}" data-hostname="${hostname}" data-id="${session.id}">
            <div class="session-card-header">
              <span class="session-label">
                ${escapeHtml(session.label)}
                ${isDefault ? '<span class="default-badge">Default</span>' : ''}
              </span>
            </div>
            <div class="session-meta">${cookieCount} cookie${cookieCount !== 1 ? 's' : ''} · ${updatedAt}</div>
            <div class="session-actions">
              ${
                isDefault
                  ? '<button class="btn btn-secondary btn-sm" disabled>Default</button>'
                  : `<button class="btn btn-default btn-sm" data-action="set-default" data-hostname="${hostname}" data-id="${session.id}">⭐ Set Default</button>`
              }
              <button class="btn btn-copy btn-sm" data-action="copy" data-hostname="${hostname}" data-id="${session.id}">📋 Copy</button>
              <button class="btn btn-ghost btn-sm" data-action="edit" data-hostname="${hostname}" data-id="${session.id}">Edit</button>
              <button class="btn btn-ghost btn-sm" data-action="delete" data-hostname="${hostname}" data-id="${session.id}">Delete</button>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="site-group ${isCollapsed ? 'collapsed' : ''}" data-hostname="${hostname}">
          <div class="site-group-header" data-action="toggle" data-hostname="${hostname}">
            <div class="site-group-info">
              <span class="site-group-chevron">${chevron}</span>
              <span class="site-group-icon">🌐</span>
              <span class="site-group-hostname">${escapeHtml(hostname)}</span>
              <span class="site-group-count">${siteData.sessions.length} session${siteData.sessions.length !== 1 ? 's' : ''}</span>
            </div>
            <button class="btn btn-ghost btn-sm" data-action="add-session" data-hostname="${hostname}" onclick="event.stopPropagation()">➕ Add</button>
          </div>
          <div class="site-group-sessions ${isCollapsed ? 'hidden' : ''}">
            ${sessionCards}
          </div>
        </div>
      `;
    })
    .join('');
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Event listeners ───

// Search with debounce
let searchTimer: ReturnType<typeof setTimeout> | null = null;
$searchInput.addEventListener('input', () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => renderAll(), 150);
});

// Theme toggle
$btnTheme.addEventListener('click', toggleTheme);

// Delegated click handler for all actions
$sitesContainer.addEventListener('click', async (e) => {
  const target = e.target as HTMLElement;

  // Accordion toggle
  const header = target.closest('[data-action="toggle"]') as HTMLElement | null;
  if (header && !target.closest('[data-action="add-session"]')) {
    const hostname = header.dataset.hostname!;
    if (collapsedSites.has(hostname)) {
      collapsedSites.delete(hostname);
    } else {
      collapsedSites.add(hostname);
    }
    renderAll();
    return;
  }

  // Other actions
  const btn = target.closest('[data-action]') as HTMLElement | null;
  if (!btn) return;

  const action = btn.dataset.action;
  const hostname = btn.dataset.hostname!;
  const sessionId = btn.dataset.id;

  switch (action) {
    case 'add-session':
      openAddModal(hostname);
      break;
    case 'set-default':
      if (sessionId) await handleSetDefault(hostname, sessionId);
      break;
    case 'copy':
      if (sessionId) await handleCopy(hostname, sessionId);
      break;
    case 'edit':
      if (sessionId) handleEdit(hostname, sessionId);
      break;
    case 'delete':
      if (sessionId) handleDeletePrompt(hostname, sessionId);
      break;
  }
});

// Modal
$btnCancel.addEventListener('click', closeModal);
$btnModalClose.addEventListener('click', closeModal);
$modalOverlay.addEventListener('click', (e) => {
  if (e.target === $modalOverlay) closeModal();
});

$sessionForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  await handleSave();
});

// Delete dialog
$btnDeleteCancel.addEventListener('click', closeDeleteDialog);
$btnDeleteConfirm.addEventListener('click', handleDeleteConfirm);
$deleteOverlay.addEventListener('click', (e) => {
  if (e.target === $deleteOverlay) closeDeleteDialog();
});

// ─── Handlers ───

function openAddModal(hostname: string) {
  editingContext = { hostname, sessionId: '' };
  $modalTitle.textContent = `Add Session — ${hostname}`;
  $inputLabel.value = '';
  $inputCookies.value = '';
  $formError.classList.add('hidden');
  $modalOverlay.classList.remove('hidden');
  $inputLabel.focus();
}

function handleEdit(hostname: string, sessionId: string) {
  const siteData = allSitesData[hostname];
  const session = siteData?.sessions.find((s) => s.id === sessionId);
  if (!session) return;

  editingContext = { hostname, sessionId };
  $modalTitle.textContent = `Edit Session — ${hostname}`;
  $inputLabel.value = session.label;
  $inputCookies.value = JSON.stringify(session.cookies, null, 2);
  $formError.classList.add('hidden');
  $modalOverlay.classList.remove('hidden');
  $inputLabel.focus();
}

async function handleSave() {
  if (!editingContext) return;

  const label = $inputLabel.value.trim();
  const cookieText = $inputCookies.value.trim();
  const { hostname, sessionId } = editingContext;

  if (!label) {
    showFormError('Please enter a session label.');
    return;
  }

  let cookies: CookieEntry[] = [];
  if (cookieText) {
    try {
      cookies = parseCookieInput(cookieText, hostname);
    } catch (err) {
      showFormError(`Invalid cookie format: ${(err as Error).message}`);
      return;
    }
  }

  try {
    if (sessionId) {
      await updateSession(hostname, sessionId, { label, cookies });
    } else {
      await addSession(hostname, label, cookies);
    }
    closeModal();
    await loadAllData();
  } catch (err) {
    showFormError(`Failed to save: ${(err as Error).message}`);
  }
}

async function handleSetDefault(hostname: string, sessionId: string) {
  try {
    await setDefaultSession(hostname, sessionId);
    await loadAllData();
    showToast('Default session updated');
  } catch (err) {
    console.error('Set default failed:', err);
    showToast('Failed to set default');
  }
}

async function handleCopy(hostname: string, sessionId: string) {
  const siteData = allSitesData[hostname];
  const session = siteData?.sessions.find((s) => s.id === sessionId);
  if (!session) return;

  try {
    const json = JSON.stringify(session.cookies, null, 2);
    await navigator.clipboard.writeText(json);
    showToast(`Copied ${session.cookies.length} cookies`);
  } catch {
    showToast('Failed to copy');
  }
}

function handleDeletePrompt(hostname: string, sessionId: string) {
  const siteData = allSitesData[hostname];
  const session = siteData?.sessions.find((s) => s.id === sessionId);
  if (!session) return;

  pendingDelete = { hostname, sessionId, label: session.label };
  $deleteLabel.textContent = session.label;
  $deleteOverlay.classList.remove('hidden');
}

async function handleDeleteConfirm() {
  if (!pendingDelete) return;

  const { hostname, sessionId } = pendingDelete;

  try {
    await deleteSession(hostname, sessionId);
    closeDeleteDialog();
    await loadAllData();
    showToast('Session deleted');
  } catch (err) {
    console.error('Delete failed:', err);
    showToast('Failed to delete session');
  }
}

// ─── UI helpers ───

function closeModal() {
  $modalOverlay.classList.add('hidden');
  editingContext = null;
  $sessionForm.reset();
  $formError.classList.add('hidden');
}

function closeDeleteDialog() {
  $deleteOverlay.classList.add('hidden');
  pendingDelete = null;
}

function showFormError(message: string) {
  $formError.textContent = message;
  $formError.classList.remove('hidden');
}
