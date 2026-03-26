# Multi-Session Extension

A Chrome extension that lets you save, label, and switch between multiple cookie sessions (accounts) per website.

## Features

- **Session CRUD** — Create, read, update, and delete sessions per site
- **Capture Current** — Snapshot your browser's current cookies into a new session
- **Manual Entry** — Add cookies via JSON array/object or `name=value` text format
- **Switch Sessions** — Apply a session's cookies and auto-reload the page
- **Copy Cookies** — Copy a session's cookies as JSON to the clipboard
- **Per-Site Isolation** — Sessions are stored independently per hostname
- **Persistent Storage** — All data is saved in `chrome.storage.local` and survives browser restarts
- **Light/Dark Theme** — Toggle between themes, persisted in localStorage

## Project Structure

```
src/
├── background/
│   └── index.ts          # Service worker: message handler for cookie operations
├── popup/
│   ├── index.html        # Popup layout (session list, modals, toast)
│   ├── index.ts          # Popup logic (init, CRUD handlers, theme toggle)
│   └── styles.css        # Dark/light theme styles with glassmorphism
├── services/
│   ├── cookies.ts        # Capture / apply / clear browser cookies
│   ├── cookie-parser.ts  # Parse JSON or text cookie input
│   └── storage.ts        # CRUD for sessions in chrome.storage.local
├── types/
│   └── index.ts          # TypeScript interfaces (CookieEntry, Session, messages)
├── manifest.json         # Extension manifest (MV3)
└── vite-env.d.ts         # Vite type declarations
public/
└── icon/                 # Extension icons (16–128px)
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
