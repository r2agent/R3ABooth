const DB_NAME = 'r3a-booth';
const STORE_NAME = 'captures';
const EVENTS_STORE = 'events';
const DB_VERSION = 3;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        db.createObjectStore(EVENTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('guests')) {
        const store = db.createObjectStore('guests', { keyPath: 'id' });
        store.createIndex('eventId', 'eventId', { unique: false });
        store.createIndex('guestFolderId', 'guestFolderId', { unique: false });
      }
      if (!db.objectStoreNames.contains('uploads')) {
        const store = db.createObjectStore('uploads', { keyPath: 'id' });
        store.createIndex('guestFolderId', 'guestFolderId', { unique: false });
        store.createIndex('guestFolderFile', ['guestFolderId', 'fileName'], { unique: true });
      }
      if (!db.objectStoreNames.contains('pendingUploads')) {
        db.createObjectStore('pendingUploads', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = null; reject(request.error); };
  });
  return dbPromise;
}

export type StoredCapture = {
  id: string;
  eventId: string;
  captureId: string;
  dataUrl: string;
  filterId: string;
  createdAt: number;
};

export type StoredResult = {
  id: string;
  eventId: string;
  frameId: string;
  dataUrl: string;
  filterId: string;
  createdAt: number;
};

export async function saveCapture(cap: StoredCapture): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(cap);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveResult(result: StoredResult): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(result);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCapturesForEvent(eventId: string): Promise<(StoredCapture | StoredResult)[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const all = req.result as (StoredCapture | StoredResult)[];
      resolve(all.filter((r) => 'eventId' in r && r.eventId === eventId));
    };
    req.onerror = () => reject(req.error);
  });
}
