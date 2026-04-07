import type { Session, ActiveTabResponse, SessionStorage } from '../types';
import { getSiteData, addSession, updateSession, deleteSession } from '../services/storage';
import { parseCookieInput } from '../services/cookie-parser';
import { getStorageStats } from '../services/storage-capture';

// ─── State ───
let currentHostname = '';
let currentTabId = 0;
let sessions: Session[] = [];
let defaultSessionId: string | null = null;
let tabSessionId: string | null = null; // session mapped to CURRENT tab
let editingSessionId: string | null = null; // null = adding new

// ─── DOM refs ───
const $loading = document.getElementById('loading')!;
const $errorScreen = document.getElementById('error-screen')!;
const $errorMessage = document.getElementById('error-message')!;
const $app = document.getElementById('app')!;

const $siteHostname = document.getElementById('site-hostname')!;
const $sessionCount = document.getElementById('session-count')!;
const $sessionList = document.getElementById('session-list')!;
const $emptyState = document.getElementById('empty-state')!;

const $btnCapture = document.getElementById('btn-capture')!;
const $btnAdd = document.getElementById('btn-add')!;
const $btnTheme = document.getElementById('btn-theme')!;
const $btnManageAll = document.getElementById('btn-manage-all')!;

const $modalOverlay = document.getElementById('modal-overlay')!;
const $modalTitle = document.getElementById('modal-title')!;
const $sessionForm = document.getElementById('session-form')! as HTMLFormElement;
const $inputLabel = document.getElementById('input-label')! as HTMLInputElement;
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

const $toast = document.getElementById('toast')!;

let pendingDeleteId: string | null = null;

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
  // Force reflow for animation
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

  try {
    const response: ActiveTabResponse = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB' });

    if ('error' in response) {
      showError(response.error as string);
      return;
    }

    currentHostname = response.hostname;
    currentTabId = response.tabId;

    $siteHostname.textContent = currentHostname;

    await loadSessions();
    showApp();
  } catch (err) {
    showError('Failed to connect to the extension. Try reloading.');
    console.error(err);
  }
}

// ─── Display helpers ───

function showError(message: string) {
  $loading.classList.add('hidden');
  $errorScreen.classList.remove('hidden');
  $errorMessage.textContent = message;
}

function showApp() {
  $loading.classList.add('hidden');
  $app.classList.remove('hidden');
}

// ─── Session loading & rendering ───

async function loadSessions() {
  const siteData = await getSiteData(currentHostname);
  sessions = siteData.sessions;
  defaultSessionId = siteData.defaultSessionId;

  // Get the session mapped to the current tab
  const tabResponse = await chrome.runtime.sendMessage({
    type: 'GET_TAB_SESSION',
    tabId: currentTabId,
    hostname: currentHostname,
  });
  tabSessionId = tabResponse?.sessionId ?? null;

  renderSessions();
}

function renderSessions() {
  $sessionCount.textContent = `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;

  if (sessions.length === 0) {
    $sessionList.classList.add('hidden');
    $emptyState.classList.remove('hidden');
    return;
  }

  $sessionList.classList.remove('hidden');
  $emptyState.classList.add('hidden');

  $sessionList.innerHTML = sessions
    .map((session) => {
      const isTabActive = session.id === tabSessionId;
      const isDefault = session.id === defaultSessionId;
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

      // Build badges
      const badges: string[] = [];
      if (isTabActive) badges.push('<span class="tab-badge">This Tab</span>');
      if (isDefault) badges.push('<span class="default-badge">Default</span>');

      return `
        <div class="session-card ${isTabActive ? 'active' : ''} ${isDefault ? 'default' : ''}" data-id="${session.id}">
          <div class="session-card-header">
            <span class="session-label">
              ${escapeHtml(session.label)}
              ${badges.join('')}
            </span>
          </div>
          <div class="session-meta">${storageText} · ${updatedAt}</div>
          <div class="session-actions">
            ${
              isTabActive
                ? '<button class="btn btn-secondary btn-sm" disabled>Current</button>'
                : `<button class="btn btn-switch btn-sm" data-action="switch" data-id="${session.id}">Use in Tab</button>`
            }
            ${
              isDefault
                ? '<button class="btn btn-secondary btn-sm" disabled>Default</button>'
                : `<button class="btn btn-default btn-sm" data-action="set-default" data-id="${session.id}" title="Use for new tabs">⭐ Set Default</button>`
            }
            <button class="btn btn-copy btn-sm" data-action="copy" data-id="${session.id}" title="Copy session data to clipboard">📋 Copy</button>
            <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${session.id}">Edit</button>
            <button class="btn btn-ghost btn-sm" data-action="delete" data-id="${session.id}">Delete</button>
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

// Session list actions (event delegation)
$sessionList.addEventListener('click', async (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest('[data-action]') as HTMLElement | null;
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id!;

  switch (action) {
    case 'switch':
      await handleSwitch(id);
      break;
    case 'set-default':
      await handleSetDefault(id);
      break;
    case 'copy':
      await handleCopy(id);
      break;
    case 'edit':
      handleEdit(id);
      break;
    case 'delete':
      handleDeletePrompt(id);
      break;
  }
});

// Capture current cookies
$btnCapture.addEventListener('click', handleCapture);

// Add new session
$btnAdd.addEventListener('click', () => {
  editingSessionId = null;
  $modalTitle.textContent = 'Add Session';
  $inputLabel.value = '';
  $inputCookies.value = '';
  $inputLocalStorage.value = '';
  $inputSessionStorage.value = '';
  $inputIndexedDB.value = '';
  $inputWebSQL.value = '';
  $formError.classList.add('hidden');
  showTab('cookies');
  $modalOverlay.classList.remove('hidden');
  $inputLabel.focus();
});

// Theme toggle
$btnTheme.addEventListener('click', toggleTheme);

// Open all-sessions management page
$btnManageAll.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/manage/index.html') });
});

// Modal close / cancel
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

// Form submit
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

async function handleCapture() {
  $btnCapture.setAttribute('disabled', '');
  try {
    const sessionData: SessionStorage = await chrome.runtime.sendMessage({
      type: 'CAPTURE_CURRENT',
      hostname: currentHostname,
      tabId: currentTabId,
    });

    const stats = getStorageStats(sessionData);
    const totalItems = stats.cookies + stats.localStorage + stats.sessionStorage + stats.indexedDB + stats.webSQL;

    if (totalItems === 0) {
      showToast('No session data found for this site');
      return;
    }

    const label = `Session ${sessions.length + 1}`;
    const session = await addSession(currentHostname, label, sessionData);

    // Map the captured session to this tab
    await chrome.runtime.sendMessage({
      type: 'SET_TAB_SESSION',
      tabId: currentTabId,
      hostname: currentHostname,
      sessionId: session.id,
      sessionData: session.sessionData,
    });

    await loadSessions();
    showToast(`Captured ${totalItems} storage items`);
  } catch (err) {
    console.error('Capture failed:', err);
    showToast('Failed to capture session data');
  } finally {
    $btnCapture.removeAttribute('disabled');
  }
}

async function handleSwitch(sessionId: string) {
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return;

  // Disable all switch buttons while switching
  const btns = $sessionList.querySelectorAll('[data-action="switch"]');
  btns.forEach((b) => b.setAttribute('disabled', ''));

  try {
    await chrome.runtime.sendMessage({
      type: 'SWITCH_SESSION',
      hostname: currentHostname,
      sessionData: session.sessionData,
      tabId: currentTabId,
      sessionId: sessionId,
    });

    await loadSessions();
  } catch (err) {
    console.error('Switch failed:', err);
    showToast('Failed to switch session');
  } finally {
    btns.forEach((b) => b.removeAttribute('disabled'));
  }
}

async function handleSetDefault(sessionId: string) {
  try {
    await chrome.runtime.sendMessage({
      type: 'SET_DEFAULT_SESSION',
      hostname: currentHostname,
      sessionId,
    });
    await loadSessions();
    showToast('Default session updated');
  } catch (err) {
    console.error('Set default failed:', err);
    showToast('Failed to set default session');
  }
}

async function handleCopy(sessionId: string) {
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return;

  try {
    const json = JSON.stringify(session.sessionData, null, 2);
    await navigator.clipboard.writeText(json);
    const stats = getStorageStats(session.sessionData);
    const total = stats.cookies + stats.localStorage + stats.sessionStorage + stats.indexedDB + stats.webSQL;
    showToast(`Copied ${total} storage items`);
  } catch (err) {
    console.error('Copy failed:', err);
    // Fallback: select text in a temporary textarea
    try {
      const textarea = document.createElement('textarea');
      textarea.value = JSON.stringify(session.sessionData, null, 2);
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      const stats = getStorageStats(session.sessionData);
      const total = stats.cookies + stats.localStorage + stats.sessionStorage + stats.indexedDB + stats.webSQL;
      showToast(`Copied ${total} storage items`);
    } catch {
      showToast('Failed to copy');
    }
  }
}

function handleEdit(sessionId: string) {
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return;

  editingSessionId = sessionId;
  $modalTitle.textContent = 'Edit Session';
  $inputLabel.value = session.label;
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
  const label = $inputLabel.value.trim();
  const cookieText = $inputCookies.value.trim();
  const localStorageText = $inputLocalStorage.value.trim();
  const sessionStorageText = $inputSessionStorage.value.trim();
  const indexedDBText = $inputIndexedDB.value.trim();
  const webSQLText = $inputWebSQL.value.trim();

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
      const cookies = parseCookieInput(cookieText, currentHostname);
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
    if (editingSessionId) {
      await updateSession(currentHostname, editingSessionId, { label, sessionData });
    } else {
      await addSession(currentHostname, label, sessionData);
    }
    closeModal();
    await loadSessions();
  } catch (err) {
    showFormError(`Failed to save: ${(err as Error).message}`);
  }
}

function handleDeletePrompt(sessionId: string) {
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return;

  pendingDeleteId = sessionId;
  $deleteLabel.textContent = session.label;
  $deleteOverlay.classList.remove('hidden');
}

async function handleDeleteConfirm() {
  if (!pendingDeleteId) return;

  const deletingId = pendingDeleteId;
  const isTabActive = deletingId === tabSessionId;
  const isDefault = deletingId === defaultSessionId;

  // Find the remaining sessions after deletion
  const remaining = sessions.filter((s) => s.id !== deletingId);

  try {
    // Delete the session
    await deleteSession(currentHostname, deletingId);

    if (isTabActive && isDefault) {
      // Deleting session that is both active + default
      // Promote next remaining session to both roles (if any)
      if (remaining.length > 0) {
        const next = remaining[0];
        await chrome.runtime.sendMessage({
          type: 'SET_DEFAULT_SESSION',
          hostname: currentHostname,
          sessionId: next.id,
        });
        await chrome.runtime.sendMessage({
          type: 'SET_TAB_SESSION',
          tabId: currentTabId,
          hostname: currentHostname,
          sessionId: next.id,
          sessionData: next.sessionData,
        });
      }
    } else if (isTabActive && defaultSessionId && defaultSessionId !== deletingId) {
      // Deleting active session → default becomes active for this tab
      const defaultSession = sessions.find((s) => s.id === defaultSessionId);
      if (defaultSession) {
        await chrome.runtime.sendMessage({
          type: 'SET_TAB_SESSION',
          tabId: currentTabId,
          hostname: currentHostname,
          sessionId: defaultSessionId,
          sessionData: defaultSession.sessionData,
        });
      }
    } else if (isDefault && !isTabActive && tabSessionId) {
      // Deleting default session (not active) → active becomes default
      await chrome.runtime.sendMessage({
        type: 'SET_DEFAULT_SESSION',
        hostname: currentHostname,
        sessionId: tabSessionId,
      });
    }

    closeDeleteDialog();
    await loadSessions();
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
  editingSessionId = null;
  $sessionForm.reset();
  $formError.classList.add('hidden');
  showTab('cookies'); // Reset to cookies tab
}

function closeDeleteDialog() {
  $deleteOverlay.classList.add('hidden');
  pendingDeleteId = null;
}

function showFormError(message: string) {
  $formError.textContent = message;
  $formError.classList.remove('hidden');
}
