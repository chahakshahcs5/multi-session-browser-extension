import type { SessionStorage, SiteData } from '../types';
import { getSiteData, addSession, updateSession, deleteSession, setDefaultSession, getAllSites } from '../services/storage';
import { parseCookieInput } from '../services/cookie-parser';
import { getStorageStats } from '../services/storage-capture';

// ─── State ───
let allSitesData: Record<string, SiteData> = {};
/** Which site groups are collapsed (true = collapsed) */
const collapsedSites = new Set<string>();
let editingContext: { hostname: string; sessionId: string } | null = null;
let pendingDelete: { hostname: string; sessionId: string; label: string } | null = null;
let capturePending = false;
let captureHostname = '';

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
const $storageTypeCheckboxes = document.querySelectorAll('input[name="storage-type"]') as NodeListOf<HTMLInputElement>;
const $inputCookies = document.getElementById('input-cookies')! as HTMLTextAreaElement;
const $inputLocalStorage = document.getElementById('input-localStorage')! as HTMLTextAreaElement;
const $inputSessionStorage = document.getElementById('input-sessionStorage')! as HTMLTextAreaElement;
const $inputIndexedDB = document.getElementById('input-indexedDB')! as HTMLTextAreaElement;
const $inputWebSQL = document.getElementById('input-webSQL')! as HTMLTextAreaElement;
const $tabButtons = document.querySelectorAll('.tab-btn') as NodeListOf<HTMLButtonElement>;
const $tabPanes = document.querySelectorAll('.tab-pane') as NodeListOf<HTMLElement>;
const $formError = document.getElementById('form-error')!;
const $btnCancel = document.getElementById('btn-cancel')!;
const $btnModalClose = document.getElementById('btn-modal-close')!;

const $deleteOverlay = document.getElementById('delete-overlay')!;
const $deleteLabel = document.getElementById('delete-label')!;
const $btnDeleteCancel = document.getElementById('btn-delete-cancel')!;
const $btnDeleteConfirm = document.getElementById('btn-delete-confirm')!;

const $captureOverlay = document.getElementById('capture-overlay')!;
const $captureTypeCheckboxes = document.querySelectorAll('input[name="capture-type"]') as NodeListOf<HTMLInputElement>;
const $btnCaptureCancel = document.getElementById('btn-capture-cancel')!;
const $btnCaptureConfirm = document.getElementById('btn-capture-confirm')!;

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
        const stats = getStorageStats(session.sessionData);
        const updatedAt = new Date(session.updatedAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

        // Build storage summary
        const storageSummary: string[] = [];
        if (stats.cookies > 0) storageSummary.push(`🍪 ${stats.cookies}`);
        if (stats.localStorage > 0) storageSummary.push(`📦 ${stats.localStorage}`);
        if (stats.sessionStorage > 0) storageSummary.push(`💾 ${stats.sessionStorage}`);
        if (stats.indexedDB > 0) storageSummary.push(`🗄️ ${stats.indexedDB}`);
        if (stats.webSQL > 0) storageSummary.push(`📊 ${stats.webSQL}`);
        
        const storageText = storageSummary.length > 0 ? storageSummary.join(' ') : 'No storage';

        return `
          <div class="session-card ${isDefault ? 'default' : ''}" data-hostname="${hostname}" data-id="${session.id}">
            <div class="session-card-header">
              <span class="session-label">
                ${escapeHtml(session.label)}
                ${isDefault ? '<span class="default-badge">Default</span>' : ''}
              </span>
            </div>
            <div class="session-meta">${storageText} · ${updatedAt}</div>
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

// Storage tab switching
$tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tabName = btn.getAttribute('data-tab');
    if (tabName) showTab(tabName);
  });
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

// Capture dialog
$btnCaptureCancel.addEventListener('click', closeCaptureDialog);
$btnCaptureConfirm.addEventListener('click', handleCaptureConfirm);
$captureOverlay.addEventListener('click', (e) => {
  if (e.target === $captureOverlay) closeCaptureDialog();
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
  
  // Set the storage type checkboxes based on enabledStorageTypes
  const enabled = session.enabledStorageTypes || {
    cookies: true,
    localStorage: true,
    sessionStorage: true,
    indexedDB: true,
    webSQL: true,
  };
  
  $storageTypeCheckboxes.forEach((checkbox) => {
    checkbox.checked = enabled[checkbox.value as keyof typeof enabled] ?? true;
  });
  
  $inputCookies.value = JSON.stringify(session.sessionData.cookies, null, 2);
  $inputLocalStorage.value = JSON.stringify(session.sessionData.localStorage, null, 2);
  $inputSessionStorage.value = JSON.stringify(session.sessionData.sessionStorage, null, 2);
  $inputIndexedDB.value = JSON.stringify(session.sessionData.indexedDB, null, 2);
  $inputWebSQL.value = JSON.stringify(session.sessionData.webSQL, null, 2);
  $formError.classList.add('hidden');
  showTab('cookies');
  $modalOverlay.classList.remove('hidden');
  $inputLabel.focus();
}

async function handleSave() {
  if (!editingContext) return;

  const label = $inputLabel.value.trim();
  
  // Collect enabled storage types from checkboxes
  const enabledStorageTypes: any = {
    cookies: false,
    localStorage: false,
    sessionStorage: false,
    indexedDB: false,
    webSQL: false,
  };
  
  $storageTypeCheckboxes.forEach((checkbox) => {
    if (checkbox.checked) {
      enabledStorageTypes[checkbox.value] = true;
    }
  });
  
  const cookieText = $inputCookies.value.trim();
  const localStorageText = $inputLocalStorage.value.trim();
  const sessionStorageText = $inputSessionStorage.value.trim();
  const indexedDBText = $inputIndexedDB.value.trim();
  const webSQLText = $inputWebSQL.value.trim();
  const { hostname, sessionId } = editingContext;

  if (!label) {
    showFormError('Please enter a session label.');
    return;
  }

  let sessionData: SessionStorage = {
    cookies: [],
    localStorage: [],
    sessionStorage: [],
    indexedDB: [],
    webSQL: [],
    fileSystem: [],
  };

  // Parse Cookies
  if (cookieText) {
    try {
      const cookies = parseCookieInput(cookieText, hostname);
      sessionData.cookies = cookies;
    } catch (err) {
      showFormError(`Invalid cookie format: ${(err as Error).message}`);
      return;
    }
  }

  // Parse localStorage
  if (localStorageText) {
    try {
      sessionData.localStorage = JSON.parse(localStorageText);
      if (!Array.isArray(sessionData.localStorage)) {
        throw new Error('Must be a JSON array');
      }
    } catch (err) {
      showFormError(`Invalid localStorage format: ${(err as Error).message}`);
      return;
    }
  }

  // Parse sessionStorage
  if (sessionStorageText) {
    try {
      sessionData.sessionStorage = JSON.parse(sessionStorageText);
      if (!Array.isArray(sessionData.sessionStorage)) {
        throw new Error('Must be a JSON array');
      }
    } catch (err) {
      showFormError(`Invalid sessionStorage format: ${(err as Error).message}`);
      return;
    }
  }

  // Parse IndexedDB
  if (indexedDBText) {
    try {
      sessionData.indexedDB = JSON.parse(indexedDBText);
      if (!Array.isArray(sessionData.indexedDB)) {
        throw new Error('Must be a JSON array');
      }
    } catch (err) {
      showFormError(`Invalid IndexedDB format: ${(err as Error).message}`);
      return;
    }
  }

  // Parse WebSQL
  if (webSQLText) {
    try {
      sessionData.webSQL = JSON.parse(webSQLText);
      if (!Array.isArray(sessionData.webSQL)) {
        throw new Error('Must be a JSON array');
      }
    } catch (err) {
      showFormError(`Invalid WebSQL format: ${(err as Error).message}`);
      return;
    }
  }

  try {
    if (sessionId) {
      await updateSession(hostname, sessionId, { label, enabledStorageTypes, sessionData });
    } else {
      await addSession(hostname, label, sessionData, enabledStorageTypes);
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
    const json = JSON.stringify(session.sessionData, null, 2);
    await navigator.clipboard.writeText(json);
    const stats = getStorageStats(session.sessionData);
    const total = stats.cookies + stats.localStorage + stats.sessionStorage + stats.indexedDB + stats.webSQL;
    showToast(`Copied ${total} storage items`);
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

function showTab(tabName: string) {
  // Hide all tabs
  $tabPanes.forEach((pane) => {
    pane.classList.add('hidden');
  });

  // Remove active class from all buttons
  $tabButtons.forEach((btn) => {
    btn.classList.remove('active');
  });

  // Show selected tab
  const selectedPane = document.getElementById(`tab-${tabName}`);
  if (selectedPane) {
    selectedPane.classList.remove('hidden');
  }

  // Activate selected button
  const selectedBtn = document.querySelector(`[data-tab="${tabName}"]`) as HTMLButtonElement | null;
  if (selectedBtn) {
    selectedBtn.classList.add('active');
  }
}

function closeModal() {
  $modalOverlay.classList.add('hidden');
  editingContext = null;
  $sessionForm.reset();
  $formError.classList.add('hidden');
  showTab('cookies'); // Reset to cookies tab
}

function closeDeleteDialog() {
  $deleteOverlay.classList.add('hidden');
  pendingDelete = null;
}

function closeCaptureDialog() {
  $captureOverlay.classList.add('hidden');
  capturePending = false;
  captureHostname = '';
}

async function handleCaptureConfirm() {
  if (!capturePending || !captureHostname) return;

  $btnCaptureConfirm.setAttribute('disabled', '');
  try {
    // Get the active tab
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) throw new Error('No active tab found');

    // Collect enabled storage types from checkboxes
    const enabledStorageTypes: any = {
      cookies: false,
      localStorage: false,
      sessionStorage: false,
      indexedDB: false,
      webSQL: false,
    };

    $captureTypeCheckboxes.forEach((checkbox) => {
      if (checkbox.checked) {
        enabledStorageTypes[checkbox.value] = true;
      }
    });

    const sessionData = await chrome.runtime.sendMessage({
      type: 'CAPTURE_CURRENT',
      hostname: captureHostname,
      tabId: activeTab.id,
      enabledStorageTypes,
    });

    const stats = getStorageStats(sessionData);
    const totalItems = stats.cookies + stats.localStorage + stats.sessionStorage + stats.indexedDB + stats.webSQL;

    if (totalItems === 0) {
      showToast('No session data found for this site');
      closeCaptureDialog();
      return;
    }

    const siteData = allSitesData[captureHostname];
    const label = `Session ${(siteData?.sessions.length || 0) + 1}`;
    await addSession(captureHostname, label, sessionData, enabledStorageTypes);

    closeCaptureDialog();
    await loadAndRender();
    showToast(`Captured ${totalItems} storage items`);
  } catch (err) {
    console.error('Capture failed:', err);
    showToast('Failed to capture session data');
  } finally {
    $btnCaptureConfirm.removeAttribute('disabled');
  }
}

function showFormError(message: string) {
  $formError.textContent = message;
  $formError.classList.remove('hidden');
}
