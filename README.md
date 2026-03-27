# Multi-Session Extension

A Chrome extension that lets you save, label, and switch between multiple cookie sessions (accounts) per website — with **per-tab session isolation** so each tab runs its own account independently.

## Features

### Core
- **Session CRUD** — Create, read, update, and delete sessions per site
- **Capture Current** — Snapshot your browser's current cookies into a new session
- **Manual Entry** — Add cookies via JSON array/object or `name=value` text format
- **Copy Cookies** — Copy a session's cookies as JSON to the clipboard
- **Per-Site Isolation** — Sessions are stored independently per hostname
- **Persistent Storage** — All data saved in `chrome.storage.local`, survives browser restarts

### Tab-Level Control
- **Per-Tab Sessions** — Each tab independently runs its own session for a site
- **Default Session** — A designated session that is automatically applied to every new tab
- **Silent Cookie Swap** — When you switch tabs, cookies are swapped automatically *without reloading*
- **Tab Fallback** — If a tab's mapped session is deleted, it falls back to the default session
- **New Window / Incognito** — Works across new windows and incognito tabs (`storeId`-aware)

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
