// Large public contest snapshots must not synchronously block screen updates.
let database;
function openCache() {
  return (database ||= new Promise((resolve) => {
    try {
      const request = indexedDB.open("icpc-display-cache", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("screens");
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          database = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        database = undefined;
        resolve(null);
      };
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}
export async function readDisplayCache(id) {
  const db = await openCache();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction("screens").objectStore("screens").get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
export async function writeDisplayCache(id, value) {
  const db = await openCache();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction("screens", "readwrite");
      transaction.oncomplete = () => resolve(true);
      transaction.onabort = transaction.onerror = () => resolve(false);
      transaction.objectStore("screens").put(value, id);
    } catch {
      resolve(false);
    }
  });
}
