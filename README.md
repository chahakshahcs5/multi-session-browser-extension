# Multi-Session Extension

A powerful Chrome extension that lets you save, manage, and switch between multiple complete session profiles across all your websites. Capture and restore **cookies, localStorage, sessionStorage, IndexedDB, and WebSQL** with per-tab isolation and automatic syncing.

## ✨ Features

### 🔐 Comprehensive Storage Capture
- **Cookies** — Captures cookies from the main domain + all parent domain levels
- **localStorage** — Saves and restores local storage for each domain
- **sessionStorage** — Captures temporary session storage
- **IndexedDB** — Captures database entries (capture only, restoration  in progress)
- **WebSQL** — Captures deprecated WebSQL data (capture only, restoration in progress)
- **Multi-Domain** — Automatically discovers and captures data from all resource domains on the page

### 📝 Session Management
- **Create Sessions** — Manually add sessions with JSON editor or `name=value` format
- **Capture Current** — Save complete browser state (all storage types) with one click
- **Edit Sessions** — Tabbed interface for editing each storage type independently
- **Copy Sessions** — Copy session JSON to clipboard for backup
- **Delete Sessions** — Remove unwanted sessions
- **Default Session** — Designate a session to auto-apply to new tabs

### 🔄 Per-Tab Session Isolation
- **Independent Sessions** — Each tab can run a different session for the same website
- **Silent Restoration** — Switch tabs and sessions are instantly restored without page reload
- **Automatic Sync** — Changes to storage are automatically captured every 3 seconds
- **Fallback Logic** — If a tab's session is deleted, falls back to default
- **Incognito Support** — Works with incognito/private mode tabs

### ⚡ Performance Optimizations
- **Parallel Captures** — All frames scanned simultaneously for storage data
- **Parallel Cookie Queries** — All domains queried in parallel (+10x faster)
- **Parallel Restore** — Cookies and client storage restored concurrently (+2x faster)
- **Fast Sync Comparison** — Smart change detection with length checks before deep comparison

### 🎨 UI Features
- **Popup Interface** — Quick access to current site's sessions from the toolbar
- **Manage Page** — Full management interface for all saved sessions across all sites
- **Dark/Light Theme** — Toggle between dark and light modes
- **Storage Tabs** — Separate tabs for Cookies, localStorage, sessionStorage, IndexedDB, WebSQL
- **Real-Time Stats** — See count of each storage type captured
- **Glassmorphism Design** — Modern aesthetic with blur effects

## 🏗️ Architecture

### Services Layer
- **`storage-capture.ts`** — Captures all session data types in parallel
  - Multi-frame storage detection
  - Cross-domain discovery
  - Parent domain cookie querying
  - Deduplication logic
  
- **`storage-restore.ts`** — Restores session data
  - Parallel cookie + client storage restoration
  - Clear-before-restore strategy
  - Error handling and fallbacks

- **`storage.ts`** — Session persistence
  - Chrome storage API wrapper
  - Session CRUD operations
  - Site-level data management
  - Default session tracking

- **`tab-session-map.ts`** — Tab to session mapping
  - Per-tab session association
  - Stale tab cleanup
  - Fallback resolution

- **`cookie-parser.ts`** — CLI input parsing
  - JSON array format: `[{"name":"sid","value":"abc"}]`
  - Text format: `name=value` (one per line)
  - Validation and normalization

### Scripts

- **`content.ts`** — Content script injected into web pages
  - Discovers all page domains from resources (iframes, scripts, images, stylesheets)
  - Captures localStorage, sessionStorage from all frames
  - Restores storage on demand
  - Communication bridge with background script

- **`background/index.ts`** — Service worker
  - Handles extension lifecycle (install, focus, navigation)
  - Orchestrates capture/restore operations
  - Auto-sync polling (3-second interval)
  - Tab and window focus management
  - Message routing

### UI

- **`popup/`** — Quick-access popup
  - Current site sessions
  - Capture button
  - Session switching
  - Session editing with tabbed UI
  
- **`manage/`** — Full management page
  - All sites and sessions
  - Search functionality
  - Bulk operations
  - Same tabbed editing interface

## 📋 Data Structures

### SessionStorage Type
```typescript
type SessionStorage = {
  cookies: CookieEntry[];
  localStorage: StorageEntry[];
  sessionStorage: StorageEntry[];
  indexedDB: IndexedDBEntry[];
  webSQL: WebSQLEntry[];
  fileSystem: any[];
};
```

### CookieEntry & StorageEntry
```typescript
type CookieEntry = chrome.cookies.Cookie;
type StorageEntry = { key: string; value: string; domain: string };
```

## 🚀 Usage

### Capturing a Session
1. Browse to any website and interact with it (login, customize, etc.)
2. Click the extension icon → **Capture** button
3. Session saved with site data (cookies, localStorage, sessionStorage)

### Switching Sessions
1. Via **popup**: Select session from the list
2. Via **manage page**: Browse all sites and click session card
3. Cookies and storage instantly restored without page reload

### Editing Sessions
1. Click edit on any session
2. Tabs for each storage type (Cookies, localStorage, sessionStorage, IndexedDB, WebSQL)
3. Edit JSON or text format
4. Save changes

### Setting Default Session
1. Right-click a session (or use UI button)
2. "Set as Default"
3. Auto-applies to all new tabs for that site

## 🔄 Auto-Sync

The extension continuously monitors active tab storage:
- **Interval**: Every 3 seconds
- **Detection**: Smart comparison (check array lengths before deep compare)
- **Action**: If data changed, automatically updates the session
- **Benefit**: Manual edits on page are preserved in the session

## 🛠️ Development

### Build
```bash
npm run build    # Build all bundles
npm run dev      # Start dev server
```

### Project Structure
```
src/
├── background/        # Service worker
├── popup/             # Popup UI
├── manage/            # Management page
├── services/          # Business logic
│   ├── storage-capture.ts
│   ├── storage-restore.ts
│   ├── storage.ts
│   ├── tab-session-map.ts
│   └── cookie-parser.ts
├── types/             # TypeScript definitions
├── content.ts         # Content script
└── manifest.json      # Extension manifest
```

### Key Technologies
- **TypeScript** — Full type safety
- **Vite** — Fast bundling and HMR
- **Chrome Extension APIs** — `chrome.cookies`, `chrome.storage`, `chrome.tabs`, `chrome.webNavigation`
- **Manifest V3** — Modern extension manifest (auto-transpiled for Firefox MV2)

## 🔐 Security & Privacy

- **All local** — Data stored entirely in `chrome.storage.local` (or Firefox equivalent)
- **No network** — Extension makes zero external requests
- **No tracking** — Zero telemetry or user tracking
- **Source available** — Code is fully available for review

## 📝 Notes

### Limitations
- **IndexedDB/WebSQL restoration** — Complex transaction logic deferred (capture works fully)
- **FileSystem API** — Not yet integrated
- **Domain scope** — Captures limited to main domain + 1 parent level (prevents cross-site pollution)

### Browser Compatibility
- ✅ Chrome/Chromium 90+
- ✅ Firefox (with MV2 transpilation)
- ✅ Edge (Chromium-based)
- ✅ Brave
- ✅ Vivaldi

## 📄 License

MIT

---

**Made with ❤️ for power users who manage multiple accounts**

### Delete Rules
- Deleting the **active** session → the default session takes over for that tab
- Deleting the **default** session (not active) → the active session becomes the new default
- Deleting a session that is **both active + default** → the next remaining session is promoted to both roles

### Cookie Sync
- Listens for `chrome.cookies.onChanged` on the active tab
- When cookies change externally (e.g. website sets new cookies), the stored session is auto-updated
- Debounced (500ms) to handle batch cookie changes efficiently

### All Sessions Manager
- Full-page management UI accessible from the popup header
- View and manage sessions across **all websites** in one place
- **Accordion** site groups — collapse/expand per host
- **Smart search** — search by hostname (shows all sessions) or by session label (shows only matches)
- Full CRUD: add, edit, delete, set default, copy cookies

### UI
- **Light/Dark Theme** — Toggle between themes, persisted in localStorage
- **Glassmorphism** design with smooth animations
- **480px** wide popup with proper vertical scrolling

## Project Structure

```
src/
├── background/
│   └── index.ts              # Service worker: tab listeners, cookie swap, message handler
├── popup/
│   ├── index.html            # Popup layout (header, session list, modals)
│   ├── index.ts              # Popup logic (per-tab display, delete rules, CRUD)
│   └── styles.css            # Dark/light theme styles
├── manage/
│   ├── index.html            # All Sessions Manager page layout
│   ├── index.ts              # Full-page CRUD for all hosts/sessions
│   └── styles.css            # Full-page styles with accordion
├── services/
│   ├── cookies.ts            # Capture / apply / clear cookies (storeId-aware)
│   ├── cookie-parser.ts      # Parse JSON or text cookie input
│   ├── storage.ts            # Session CRUD + defaultSessionId in chrome.storage.local
│   └── tab-session-map.ts    # In-memory + persisted tab↔session mapping
├── types/
│   └── index.ts              # TypeScript interfaces (CookieEntry, Session, messages)
├── manifest.json             # Extension manifest (MV3, incognito: spanning)
└── vite-env.d.ts
public/
└── icon/                     # Extension icons (16–128px)
```

## Development

```bash
# Install dependencies
pnpm install

# Start dev server (watches for changes, auto-reloads extension)
pnpm dev

# Production build
pnpm build

# Type check
pnpm compile
```

## Loading in Chrome

1. Run `pnpm build`
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** → select the `dist/` folder
5. Navigate to any website and click the extension icon

## Cookie Input Formats

### JSON

```json
[
  { "name": "session_id", "value": "abc123", "domain": ".example.com" },
  { "name": "token", "value": "xyz789" }
]
```

### Text (name=value)

```
session_id=abc123
token=xyz789
```

Or semicolon-separated: `session_id=abc123; token=xyz789`

## Tech Stack

- [vite-plugin-web-extension](https://github.com/aklinker1/vite-plugin-web-extension) — Vite-based build tooling
- TypeScript
- Chrome Extension Manifest V3
- `chrome.cookies`, `chrome.storage`, `chrome.tabs` APIs
