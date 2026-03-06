const DB_NAME = "urgentdash-cache";
const STORE_NAME = "dashboard";
const CACHE_KEY = "latest";

export function openDB() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });
}

function runTransaction(mode, executor) {
  return openDB()
    .then((db) => {
      if (!db) return null;

      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);

        tx.oncomplete = () => {
          db.close();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error || new Error("IndexedDB transaction failed"));
        };

        executor(store, resolve, reject, db);
      });
    })
    .catch(() => null);
}

export function cacheLastDash(dashboard) {
  if (!dashboard) return Promise.resolve(null);

  const payload = {
    dashboard,
    cachedAt: new Date().toISOString()
  };

  return runTransaction("readwrite", (store, resolve, reject) => {
    const request = store.put(payload, CACHE_KEY);
    request.onsuccess = () => resolve(payload);
    request.onerror = () => reject(request.error || new Error("IndexedDB put failed"));
  });
}

export function loadCachedDash() {
  return runTransaction("readonly", (store, resolve, reject) => {
    const request = store.get(CACHE_KEY);
    request.onsuccess = () => {
      const payload = request.result;
      if (!payload || typeof payload !== "object" || !payload.dashboard) {
        resolve(null);
        return;
      }
      resolve(payload);
    };
    request.onerror = () => reject(request.error || new Error("IndexedDB get failed"));
  });
}
