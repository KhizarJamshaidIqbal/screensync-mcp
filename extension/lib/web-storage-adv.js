// ScreenSync Advanced Storage Unit — IndexedDB & CacheStorage inspection
// Self-contained page-side unit designed for chrome.scripting.executeScript ({ func, args }).

export async function ssWebUnitStorageAdv(args = {}) {
  const tool = String(args.__tool || '');

  // ── 1. web_indexeddb: Complete IndexedDB schema & data inspection ─────────
  if (tool === 'web_indexeddb') {
    const action = String(args.action || 'databases').toLowerCase();

    // Action A: List databases
    if (action === 'databases') {
      try {
        if (!window.indexedDB) return { ok: false, error: 'IndexedDB is not supported on this origin.' };
        if (typeof indexedDB.databases === 'function') {
          const dbs = await indexedDB.databases();
          return {
            ok: true,
            data: {
              origin: window.location.origin,
              count: dbs.length,
              databases: dbs.map((d) => ({ name: d.name, version: d.version })),
            },
          };
        }
        return { ok: false, error: 'indexedDB.databases() is not supported in this browser environment.' };
      } catch (e) {
        return { ok: false, error: `Failed to list databases: ${String((e && e.message) || e)}` };
      }
    }

    // Helper: open a database promise-wrapped
    function openDb(dbName, version) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timed out opening database "${dbName}" after 10000ms`)), 10000);
        const req = version ? indexedDB.open(dbName, version) : indexedDB.open(dbName);
        req.onsuccess = () => { clearTimeout(timeout); resolve(req.result); };
        req.onerror = () => { clearTimeout(timeout); reject(req.error || new Error('Failed to open database')); };
        req.onblocked = () => { clearTimeout(timeout); reject(new Error(`Opening database "${dbName}" is blocked by another connection`)); };
      });
    }

    // Action B: Schema inspection
    if (action === 'schema') {
      const dbName = String(args.database || '');
      if (!dbName) return { ok: false, error: 'web_indexeddb action="schema" requires "database" name.' };
      try {
        const db = await openDb(dbName, args.version);
        const storeNames = Array.from(db.objectStoreNames);
        if (storeNames.length === 0) {
          db.close();
          return {
            ok: true,
            data: {
              database: dbName,
              version: db.version,
              storeCount: 0,
              stores: [],
            },
          };
        }
        const tx = db.transaction(storeNames, 'readonly');
        const stores = storeNames.map((sName) => {
          const s = tx.objectStore(sName);
          const indexNames = Array.from(s.indexNames);
          const indexes = indexNames.map((iName) => {
            const idx = s.index(iName);
            return { name: idx.name, keyPath: idx.keyPath, unique: idx.unique, multiEntry: idx.multiEntry };
          });
          return {
            name: s.name,
            keyPath: s.keyPath,
            autoIncrement: s.autoIncrement,
            indexes,
          };
        });
        db.close();
        return {
          ok: true,
          data: {
            database: dbName,
            version: db.version,
            storeCount: stores.length,
            stores,
          },
        };
      } catch (e) {
        return { ok: false, error: `Failed to read schema for database "${dbName}": ${String((e && e.message) || e)}` };
      }
    }

    // Action C: Dump or Query records
    if (action === 'dump' || action === 'query') {
      const dbName = String(args.database || '');
      const storeName = String(args.store || '');
      if (!dbName || !storeName) {
        return { ok: false, error: 'web_indexeddb action="dump"|"query" requires both "database" and "store".' };
      }
      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 500);
      const offset = Math.max(Number(args.offset) || 0, 0);

      try {
        const db = await openDb(dbName, args.version);
        if (!db.objectStoreNames.contains(storeName)) {
          db.close();
          return { ok: false, error: `Object store "${storeName}" not found in database "${dbName}".` };
        }
        const tx = db.transaction([storeName], 'readonly');
        const s = tx.objectStore(storeName);

        let source = s;
        if (args.indexName && s.indexNames.contains(String(args.indexName))) {
          source = s.index(String(args.indexName));
        }

        let keyRange = null;
        if (args.key) {
          keyRange = IDBKeyRange.only(args.key);
        } else if (args.lower || args.upper) {
          if (args.lower && args.upper) {
            keyRange = IDBKeyRange.bound(args.lower, args.upper, args.lowerOpen === true, args.upperOpen === true);
          } else if (args.lower) {
            keyRange = IDBKeyRange.lowerBound(args.lower, args.lowerOpen === true);
          } else {
            keyRange = IDBKeyRange.upperBound(args.upper, args.upperOpen === true);
          }
        }

        const records = [];
        let skipped = 0;

        await new Promise((resolve, reject) => {
          const req = source.openCursor(keyRange, args.direction || 'next');
          req.onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (!cursor) { resolve(); return; }
            if (skipped < offset) {
              skipped++;
              cursor.continue();
              return;
            }
            if (records.length < limit) {
              try {
                // Safe JSON serialization of record values
                const safeValue = JSON.parse(JSON.stringify(cursor.value));
                records.push({ key: cursor.key, primaryKey: cursor.primaryKey, value: safeValue });
              } catch {
                records.push({ key: cursor.key, primaryKey: cursor.primaryKey, value: String(cursor.value) });
              }
              cursor.continue();
            } else {
              resolve();
            }
          };
          req.onerror = () => reject(req.error || new Error('Cursor iteration failed'));
        });

        db.close();
        return {
          ok: true,
          data: {
            database: dbName,
            store: storeName,
            index: args.indexName || null,
            count: records.length,
            records,
          },
        };
      } catch (e) {
        return { ok: false, error: `Failed to query IndexedDB: ${String((e && e.message) || e)}` };
      }
    }

    return { ok: false, error: `Unknown web_indexeddb action: "${action}". Supported: databases, schema, dump, query.` };
  }

  // ── 2. web_cache_storage: Service Worker CacheStorage inspection ─────────
  if (tool === 'web_cache_storage') {
    const action = String(args.action || 'list').toLowerCase();
    if (!window.caches) return { ok: false, error: 'CacheStorage API is not supported on this origin.' };

    try {
      if (action === 'list') {
        const cacheNames = await caches.keys();
        return {
          ok: true,
          data: {
            origin: window.location.origin,
            count: cacheNames.length,
            caches: cacheNames,
          },
        };
      }

      if (action === 'keys') {
        const cacheName = String(args.cache || '');
        if (!cacheName) return { ok: false, error: 'web_cache_storage action="keys" requires "cache" name.' };
        const exists = await caches.has(cacheName);
        if (!exists) return { ok: false, error: `Cache "${cacheName}" does not exist.` };
        const cache = await caches.open(cacheName);
        const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 500);
        const requests = await cache.keys();
        const urls = requests.slice(0, limit).map((r) => ({
          url: r.url,
          method: r.method,
        }));
        return {
          ok: true,
          data: {
            cache: cacheName,
            totalKeys: requests.length,
            returned: urls.length,
            entries: urls,
          },
        };
      }

      if (action === 'match') {
        const url = String(args.url || '');
        if (!url) return { ok: false, error: 'web_cache_storage action="match" requires "url".' };
        let resp = null;
        let matchedCache = null;

        if (args.cache) {
          const cache = await caches.open(String(args.cache));
          resp = await cache.match(url);
          matchedCache = args.cache;
        } else {
          resp = await caches.match(url);
        }

        if (!resp) return { ok: true, data: { matched: false, url } };

        const headers = {};
        resp.headers.forEach((v, k) => { headers[k] = v; });
        let bodySnippet = '';
        try {
          const text = await resp.clone().text();
          bodySnippet = text.slice(0, 1000);
        } catch {}

        return {
          ok: true,
          data: {
            matched: true,
            cache: matchedCache,
            status: resp.status,
            statusText: resp.statusText,
            type: resp.type,
            headers,
            bodySnippet,
          },
        };
      }

      return { ok: false, error: `Unknown web_cache_storage action: "${action}". Supported: list, keys, match.` };
    } catch (e) {
      return { ok: false, error: `CacheStorage operation failed: ${String((e && e.message) || e)}` };
    }
  }

  return { ok: false, error: `Unknown ssWebUnitStorageAdv tool: ${tool}` };
}
