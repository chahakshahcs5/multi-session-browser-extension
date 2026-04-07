/**
 * Content Script for Multi-Session Extension
 * Injected into all webpages to capture and restore session storage data
 * (localStorage, sessionStorage, IndexedDB, WebSQL)
 */

import type {
  StorageEntry,
  IndexedDBEntry,
  IndexedDBStore,
  WebSQLEntry,
  WebSQLTable,
} from './types/index';

interface StorageCapture {
  localStorage: StorageEntry[];
  sessionStorage: StorageEntry[];
  indexedDB: IndexedDBEntry[];
  webSQL: WebSQLEntry[];
}

/**
 * Get all unique domains loaded on the current page
 * Includes iframes, scripts, images, etc.
 */
function getAllPageDomains(): Set<string> {
  const domains = new Set<string>();

  try {
    // Add current page domain
    domains.add(window.location.hostname);

    // Get domains from all iframes
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach((iframe) => {
      try {
        if (iframe.src) {
          const url = new URL(iframe.src);
          if (url.hostname) {
            domains.add(url.hostname);
          }
        }
      } catch (e) {
        // Ignore parsing errors
      }
    });

    // Get domains from script tags
    const scripts = document.querySelectorAll('script[src]');
    scripts.forEach((script) => {
      try {
        const src = script.getAttribute('src');
        if (src && src.startsWith('http')) {
          const url = new URL(src);
          if (url.hostname) {
            domains.add(url.hostname);
          }
        }
      } catch (e) {
        // Ignore parsing errors
      }
    });

    // Get domains from link tags (stylesheets, preconnect, etc.)
    const links = document.querySelectorAll('link[href]');
    links.forEach((link) => {
      try {
        const href = link.getAttribute('href');
        if (href && href.startsWith('http')) {
          const url = new URL(href);
          if (url.hostname) {
            domains.add(url.hostname);
          }
        }
      } catch (e) {
        // Ignore parsing errors
      }
    });

    // Get domains from img tags
    const imgs = document.querySelectorAll('img[src]');
    imgs.forEach((img) => {
      try {
        const src = img.getAttribute('src');
        if (src && src.startsWith('http')) {
          const url = new URL(src);
          if (url.hostname) {
            domains.add(url.hostname);
          }
        }
      } catch (e) {
        // Ignore parsing errors
      }
    });
  } catch (error) {
    console.warn('[MultiSession] Failed to collect page domains:', error);
  }

  return domains;
}

/**
 * Capture storage from all iframes on the page (same-origin only)
 * Iframes from different origins are blocked by CORS
 */
async function captureStorageFromIframes(): Promise<StorageCapture> {
  const allData: StorageCapture = {
    localStorage: [],
    sessionStorage: [],
    indexedDB: [],
    webSQL: [],
  };

  try {
    const iframes = document.querySelectorAll('iframe');
    
    for (const iframe of iframes) {
      try {
        const iframeWindow = iframe.contentWindow;
        if (!iframeWindow) continue;

        // Try to access iframe's storage (same-origin only)
        try {
          // localStorage
          if (iframeWindow.localStorage) {
            const domain = iframeWindow.location.hostname;
            for (let i = 0; i < iframeWindow.localStorage.length; i++) {
              const key = iframeWindow.localStorage.key(i);
              if (key) {
                const value = iframeWindow.localStorage.getItem(key);
                if (value) {
                  allData.localStorage.push({ key, value, domain });
                }
              }
            }
          }

          // sessionStorage
          if (iframeWindow.sessionStorage) {
            const domain = iframeWindow.location.hostname;
            for (let i = 0; i < iframeWindow.sessionStorage.length; i++) {
              const key = iframeWindow.sessionStorage.key(i);
              if (key) {
                const value = iframeWindow.sessionStorage.getItem(key);
                if (value) {
                  allData.sessionStorage.push({ key, value, domain });
                }
              }
            }
          }
        } catch (err) {
          // Cross-origin iframe - skip it
          console.debug(
            '[MultiSession] Skipping cross-origin iframe storage:',
            err
          );
        }
      } catch (err) {
        console.warn('[MultiSession] Error accessing iframe storage:', err);
      }
    }
  } catch (err) {
    console.warn('[MultiSession] Failed to capture iframe storage:', err);
  }

  return allData;
}

/**
 * Capture storage from all frames on the page
 */
async function captureAllFramesStorage(): Promise<StorageCapture> {
  const mainData: StorageCapture = {
    localStorage: await captureLocalStorage(),
    sessionStorage: await captureSessionStorage(),
    indexedDB: await captureIndexedDB(),
    webSQL: await captureWebSQL(),
  };

  const iframeData = await captureStorageFromIframes();

  // Merge results, deduplication happens by key+domain
  const seenKeys = new Set<string>();

  // Add main frame data
  mainData.localStorage.forEach((item) => {
    seenKeys.add(`${item.domain}:${item.key}`);
  });
  mainData.sessionStorage.forEach((item) => {
    seenKeys.add(`${item.domain}:${item.key}`);
  });

  // Add iframe data (avoid duplicates)
  iframeData.localStorage.forEach((item) => {
    const key = `${item.domain}:${item.key}`;
    if (!seenKeys.has(key)) {
      mainData.localStorage.push(item);
      seenKeys.add(key);
    }
  });

  iframeData.sessionStorage.forEach((item) => {
    const key = `${item.domain}:${item.key}`;
    if (!seenKeys.has(key)) {
      mainData.sessionStorage.push(item);
      seenKeys.add(key);
    }
  });

  return mainData;
}


async function captureLocalStorage(): Promise<StorageEntry[]> {
  try {
    const entries: StorageEntry[] = [];
    const domain = window.location.hostname;

    if (!window.localStorage) return entries;

    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key) {
        try {
          const value = window.localStorage.getItem(key);
          if (value) {
            entries.push({
              key,
              value,
              domain,
            });
          }
        } catch (e) {
          console.warn(`[MultiSession] Failed to read localStorage key: ${key}`, e);
        }
      }
    }

    return entries;
  } catch (error) {
    console.warn('[MultiSession] localStorage capture failed:', error);
    return [];
  }
}

/**
 * Capture all sessionStorage entries for current domain
 */
async function captureSessionStorage(): Promise<StorageEntry[]> {
  try {
    const entries: StorageEntry[] = [];
    const domain = window.location.hostname;

    if (!window.sessionStorage) return entries;

    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (key) {
        try {
          const value = window.sessionStorage.getItem(key);
          if (value) {
            entries.push({
              key,
              value,
              domain,
            });
          }
        } catch (e) {
          console.warn(`[MultiSession] Failed to read sessionStorage key: ${key}`, e);
        }
      }
    }

    return entries;
  } catch (error) {
    console.warn('[MultiSession] sessionStorage capture failed:', error);
    return [];
  }
}

/**
 * Capture all IndexedDB databases and their data for current domain
 */
async function captureIndexedDB(): Promise<IndexedDBEntry[]> {
  try {
    const entries: IndexedDBEntry[] = [];
    const domain = window.location.hostname;

    if (!window.indexedDB) return entries;

    // Get all database names
    const dbNames = await (window.indexedDB as any).databases?.() ?? [];

    for (const dbInfo of dbNames) {
      const dbName = typeof dbInfo === 'string' ? dbInfo : dbInfo.name;

      try {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = window.indexedDB.open(dbName);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          request.onblocked = () => console.warn(`[MultiSession] IndexedDB open blocked for ${dbName}`);
        });

        const stores: IndexedDBStore[] = [];

        // Iterate through all stores
        for (let i = 0; i < db.objectStoreNames.length; i++) {
          const storeName = db.objectStoreNames[i];

          try {
            const storeData = await new Promise<any[]>((resolve, reject) => {
              const transaction = db.transaction(storeName, 'readonly');
              const store = transaction.objectStore(storeName);
              const request = store.getAll();

              request.onsuccess = () => {
                try {
                  // Try to serialize entries
                  const serialized = (request.result as any[]).map(item =>
                    JSON.parse(JSON.stringify(item))
                  );
                  resolve(serialized);
                } catch (e) {
                  console.warn(
                    `[MultiSession] Failed to serialize store ${storeName} in ${dbName}`,
                    e
                  );
                  resolve([]);
                }
              };
              request.onerror = () => reject(request.error);
            });

            stores.push({
              name: storeName,
              entries: storeData,
            });
          } catch (error) {
            console.warn(
              `[MultiSession] Failed to read IndexedDB store ${storeName} in ${dbName}:`,
              error
            );
          }
        }

        if (stores.length > 0) {
          entries.push({
            database: dbName,
            domain,
            stores,
          });
        }

        db.close();
      } catch (error) {
        console.warn(`[MultiSession] Failed to open IndexedDB database ${dbName}:`, error);
      }
    }

    return entries;
  } catch (error) {
    console.warn('[MultiSession] IndexedDB capture failed:', error);
    return [];
  }
}

/**
 * Capture all WebSQL databases and their data for current domain
 */
async function captureWebSQL(): Promise<WebSQLEntry[]> {
  try {
    const entries: WebSQLEntry[] = [];
    const domain = window.location.hostname;

    // WebSQL is deprecated and limited access in modern browsers
    if (!(window as any).openDatabase) return entries;

    // Note: WebSQL API doesn't provide a way to enumerate databases
    // We can only capture if we know the database names
    // For now, we'll try common database names
    const commonDatabases = [
      'storage',
      'db',
      'data',
      'cache',
      'session',
      `${window.location.hostname}`,
    ];

    for (const dbName of commonDatabases) {
      try {
        const db = (window as any).openDatabase(dbName, '', '', 5 * 1024 * 1024);

        const tables: WebSQLTable[] = [];

        // Try to read sqlite_master to list tables
        await new Promise<void>((resolve, reject) => {
          db.transaction((tx: any) => {
            tx.executeSql(
              "SELECT name FROM sqlite_master WHERE type='table'",
              [],
              (tx: any, result: any) => {
                const tableNames: string[] = [];
                for (let i = 0; i < result.rows.length; i++) {
                  tableNames.push(result.rows.item(i).name);
                }

                // Read each table
                let tablesRead = 0;
                tableNames.forEach(tableName => {
                  tx.executeSql(
                    `SELECT * FROM ${tableName}`,
                    [],
                    (_: any, result: any) => {
                      const columns = result.columns;
                      const entries: any[] = [];
                      for (let i = 0; i < result.rows.length; i++) {
                        entries.push(result.rows.item(i));
                      }

                      tables.push({
                        name: tableName,
                        columns,
                        entries,
                      });

                      tablesRead++;
                      if (tablesRead === tableNames.length) resolve();
                    },
                    (_: any, error: any) => {
                      console.warn(
                        `[MultiSession] Failed to read WebSQL table ${tableName}:`,
                        error
                      );
                      tablesRead++;
                      if (tablesRead === tableNames.length) resolve();
                    }
                  );
                });

                if (tableNames.length === 0) resolve();
              },
              (_: any, error: any) => {
                console.warn(`[MultiSession] Failed to read WebSQL master table:`, error);
                reject(error);
              }
            );
          });
        });

        if (tables.length > 0) {
          entries.push({
            database: dbName,
            domain,
            tables,
          });
        }
      } catch (error) {
        // Database might not exist, continue to next
      }
    }

    return entries;
  } catch (error) {
    console.warn('[MultiSession] WebSQL capture failed:', error);
    return [];
  }
}

/**
 * Restore localStorage entries from a captured session
 */
async function restoreLocalStorage(entries: StorageEntry[]): Promise<void> {
  try {
    if (!window.localStorage) return;

    for (const entry of entries) {
      try {
        window.localStorage.setItem(entry.key, entry.value);
      } catch (e) {
        console.warn(
          `[MultiSession] Failed to restore localStorage key: ${entry.key}`,
          e
        );
      }
    }
  } catch (error) {
    console.warn('[MultiSession] localStorage restore failed:', error);
  }
}

/**
 * Restore sessionStorage entries from a captured session
 */
async function restoreSessionStorage(entries: StorageEntry[]): Promise<void> {
  try {
    if (!window.sessionStorage) return;

    for (const entry of entries) {
      try {
        window.sessionStorage.setItem(entry.key, entry.value);
      } catch (e) {
        console.warn(
          `[MultiSession] Failed to restore sessionStorage key: ${entry.key}`,
          e
        );
      }
    }
  } catch (error) {
    console.warn('[MultiSession] sessionStorage restore failed:', error);
  }
}

/**
 * Clear localStorage for current domain
 */
function clearLocalStorage(): void {
  try {
    if (window.localStorage) {
      window.localStorage.clear();
    }
  } catch (error) {
    console.warn('[MultiSession] localStorage clear failed:', error);
  }
}

/**
 * Clear sessionStorage for current domain
 */
function clearSessionStorage(): void {
  try {
    if (window.sessionStorage) {
      window.sessionStorage.clear();
    }
  } catch (error) {
    console.warn('[MultiSession] sessionStorage clear failed:', error);
  }
}

/**
 * Main message listener for background script requests
 */
chrome.runtime.onMessage.addListener((request: any, _: any, sendResponse: any) => {
  if (!request.type) return;

  (async () => {
    try {
      switch (request.type) {
        case 'CAPTURE_STORAGE': {
          const captured: StorageCapture = await captureAllFramesStorage();
          const domains = Array.from(getAllPageDomains());
          sendResponse({ success: true, data: captured, domains });
          break;
        }

        case 'RESTORE_STORAGE': {
          const { localStorage, sessionStorage } = request.data;

          // Clear before restoring
          if (request.clearFirst) {
            clearLocalStorage();
            clearSessionStorage();
          }

          if (localStorage) {
            await restoreLocalStorage(localStorage);
          }
          if (sessionStorage) {
            await restoreSessionStorage(sessionStorage);
          }

          // Note: IndexedDB and WebSQL restoration is complex and would require
          // separate message/logic due to transaction requirements
          sendResponse({ success: true });
          break;
        }

        case 'CLEAR_STORAGE': {
          clearLocalStorage();
          clearSessionStorage();
          // Note: IndexedDB/WebSQL clearing would require additional implementation
          sendResponse({ success: true });
          break;
        }

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('[MultiSession] Content script error:', error);
      sendResponse({ success: false, error: String(error) });
    }
  })();

  // Return true to indicate we'll send response asynchronously
  return true;
});
