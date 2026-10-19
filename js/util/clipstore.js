// Keeps your own voice recordings on this device (IndexedDB, which can hold
// audio files; localStorage can't). If storage is blocked, it quietly does nothing.

const DB = 'shiftgrid-voice';
const STORE = 'clips';
let dbPromise = null;

function open() {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result ?? null);
      tx.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export const getClip = (key) => run('readonly', (s) => s.get(key));
export const putClip = (key, blob) => run('readwrite', (s) => s.put(blob, key));
export const deleteClip = (key) => run('readwrite', (s) => s.delete(key));
export const listClips = async () => (await run('readonly', (s) => s.getAllKeys())) ?? [];
