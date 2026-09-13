// Guest folder persistence — IndexedDB store for per-event guest records.
// Each event has its own guest counter. Guest folders are created in Google Drive
// inside the admin-selected MAIN folder. Duplicate prevention: we check for
// existing guest records before creating new ones.

import { getValidToken, shareFolderWithAnyone } from './gdriveService';

export type GuestRecord = {
  id: string;
  eventId: string;
  guestNumber: number;
  guestName: string;
  guestFolderId: string;
  mainFolderId: string;
  createdAt: number;
};

const DB_NAME = 'r3a-booth';
const GUESTS_STORE = 'guests';
const DB_VERSION = 3;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GUESTS_STORE)) {
        const store = db.createObjectStore(GUESTS_STORE, { keyPath: 'id' });
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

export async function getGuestsForEvent(eventId: string): Promise<GuestRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GUESTS_STORE, 'readonly');
    const index = tx.objectStore(GUESTS_STORE).index('eventId');
    const req = index.getAll(eventId);
    req.onsuccess = () => {
      const all = req.result as GuestRecord[];
      resolve(all.sort((a, b) => a.guestNumber - b.guestNumber));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getGuestCount(eventId: string): Promise<number> {
  const guests = await getGuestsForEvent(eventId);
  return guests.length;
}

export async function saveGuest(guest: GuestRecord): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GUESTS_STORE, 'readwrite');
    tx.objectStore(GUESTS_STORE).put(guest);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function findGuestByFolderId(guestFolderId: string): Promise<GuestRecord | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GUESTS_STORE, 'readonly');
    const index = tx.objectStore(GUESTS_STORE).index('guestFolderId');
    const req = index.get(guestFolderId);
    req.onsuccess = () => resolve(req.result as GuestRecord | undefined);
    req.onerror = () => reject(req.error);
  });
}

// --- Google Drive folder creation -------------------------------------------

/**
 * Search for an existing folder by name inside a parent folder.
 */
async function findFolderByName(parentId: string, name: string, token: string): Promise<string | null> {
  const query = `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,parents)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = await res.json();
  const files = data.files as Array<{ id: string; name: string; parents?: string[] }>;
  const match = files.find((f) => f.parents?.includes(parentId));
  return match?.id ?? null;
}

/**
 * Create a folder inside a parent folder, or return existing folder ID if it already exists.
 */
async function createFolder(parentId: string, name: string, token: string): Promise<string> {
  const existing = await findFolderByName(parentId, name, token);
  if (existing) return existing;

  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Failed to create folder: ${res.status}`);
  }
  const data = await res.json();
  return data.id as string;
}

export type CreateGuestFolderResult = {
  success: boolean;
  guest?: GuestRecord;
  error?: string;
};

/**
 * Get or create the next guest folder for an event.
 * - Increments the guest counter for this event.
 * - Creates "Guest N" folder inside mainFolderId.
 * - If the folder already exists (e.g. after a page refresh), reuses it.
 * - Prevents duplicates by checking IndexedDB first.
 */
export async function getOrCreateNextGuestFolder(
  eventId: string,
  mainFolderId: string,
  clientId: string,
): Promise<CreateGuestFolderResult> {
  if (!clientId) return { success: false, error: 'Google Drive not configured. Connect and select a MAIN folder in Settings first.' };
  if (!mainFolderId) return { success: false, error: 'No MAIN folder selected. Select a folder in Settings > Storage & Upload first.' };

  try {
    const token = await getValidToken(clientId);
    const existingGuests = await getGuestsForEvent(eventId);
    const nextNumber = existingGuests.length + 1;
    const guestName = `Guest ${nextNumber}`;

    const folderId = await createFolder(mainFolderId, guestName, token);

    const existingRecord = await findGuestByFolderId(folderId);
    if (existingRecord) {
      return { success: true, guest: existingRecord };
    }

    void shareFolderWithAnyone(folderId, clientId);

    const guest: GuestRecord = {
      id: `gst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      eventId,
      guestNumber: nextNumber,
      guestName,
      guestFolderId: folderId,
      mainFolderId,
      createdAt: Date.now(),
    };
    await saveGuest(guest);

    return { success: true, guest };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create guest folder' };
  }
}
