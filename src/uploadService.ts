// Google Drive auto-upload for guest photos.
// Uploads final.jpg + slot-01.jpg, slot-02.jpg, etc. to the guest's folder.
// Silent failure: never throws to caller, never shows progress to guest.
// Duplicate prevention: checks existing files by name in the guest folder before uploading.

import { getValidToken } from './gdriveService';
import type { GuestRecord } from './guestStore';

export type UploadFileEntry = {
  fileName: string;
  dataUrl: string;
};

export type PendingUpload = {
  id: string;
  guestFolderId: string;
  fileName: string;
  dataUrl: string;
  createdAt: number;
};

const PENDING_STORE = 'pendingUploads';

export type UploadResult = {
  fileName: string;
  fileId: string | null;
  success: boolean;
};

// --- Upload record persistence (IndexedDB) -----------------------------------

const DB_NAME = 'r3a-booth';
const UPLOADS_STORE = 'uploads';
const DB_VERSION = 3;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(UPLOADS_STORE)) {
        const store = db.createObjectStore(UPLOADS_STORE, { keyPath: 'id' });
        store.createIndex('guestFolderId', 'guestFolderId', { unique: false });
        store.createIndex('guestFolderFile', ['guestFolderId', 'fileName'], { unique: true });
      }
      if (!db.objectStoreNames.contains(PENDING_STORE)) {
        db.createObjectStore(PENDING_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = null; reject(request.error); };
  });
  return dbPromise;
}

type UploadRecord = {
  id: string;
  guestFolderId: string;
  fileName: string;
  fileId: string;
  uploadedAt: number;
};

async function getExistingUpload(guestFolderId: string, fileName: string): Promise<UploadRecord | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPLOADS_STORE, 'readonly');
    const index = tx.objectStore(UPLOADS_STORE).index('guestFolderFile');
    const req = index.get([guestFolderId, fileName]);
    req.onsuccess = () => resolve(req.result as UploadRecord | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function saveUploadRecord(rec: UploadRecord): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPLOADS_STORE, 'readwrite');
    tx.objectStore(UPLOADS_STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function savePendingUpload(rec: PendingUpload): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, 'readwrite');
    tx.objectStore(PENDING_STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deletePendingUpload(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, 'readwrite');
    tx.objectStore(PENDING_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllPendingUploads(): Promise<PendingUpload[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, 'readonly');
    const req = tx.objectStore(PENDING_STORE).getAll();
    req.onsuccess = () => resolve(req.result as PendingUpload[]);
    req.onerror = () => reject(req.error);
  });
}

// --- Google Drive helpers ----------------------------------------------------

async function findFileByName(parentId: string, name: string, token: string): Promise<string | null> {
  const query = `name = '${name}' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,parents)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = await res.json();
  const files = data.files as Array<{ id: string; name: string; parents?: string[] }>;
  const match = files.find((f) => f.parents?.includes(parentId));
  return match?.id ?? null;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, base64] = dataUrl.split(',');
  const mime = meta.match(/data:(.*?);/)?.[1] || 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function uploadFile(
  parentId: string,
  fileName: string,
  dataUrl: string,
  token: string,
): Promise<string> {
  const existing = await findFileByName(parentId, fileName, token);
  if (existing) return existing;

  const blob = dataUrlToBlob(dataUrl);
  const metadata = { name: fileName, parents: [parentId] };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Upload failed: ${res.status}`);
  }
  const data = await res.json();
  return data.id as string;
}

// --- Public API ---------------------------------------------------------------

export type AutoUploadResult = {
  uploaded: number;
  skipped: number;
  failed: number;
  results: UploadResult[];
};

/**
 * Upload final.jpg and slot photos to the guest's Google Drive folder.
 * - Silently skips if Drive not connected or no guest folder.
 * - Prevents duplicates by checking existing files and IndexedDB records.
 * - Never throws — returns a result object.
 */
export async function autoUploadToGuestFolder(
  guest: GuestRecord,
  clientId: string,
  files: UploadFileEntry[],
): Promise<AutoUploadResult> {
  const result: AutoUploadResult = { uploaded: 0, skipped: 0, failed: 0, results: [] };

  if (!clientId || !guest.guestFolderId) return result;

  let token: string;
  try {
    token = await getValidToken(clientId);
  } catch {
    return result;
  }

  for (const file of files) {
    try {
      const existingRecord = await getExistingUpload(guest.guestFolderId, file.fileName);
      if (existingRecord) {
        result.skipped++;
        result.results.push({ fileName: file.fileName, fileId: existingRecord.fileId, success: true });
        continue;
      }

      const fileId = await uploadFile(guest.guestFolderId, file.fileName, file.dataUrl, token);

      await saveUploadRecord({
        id: `upl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        guestFolderId: guest.guestFolderId,
        fileName: file.fileName,
        fileId,
        uploadedAt: Date.now(),
      });

      result.uploaded++;
      result.results.push({ fileName: file.fileName, fileId, success: true });
    } catch {
      result.failed++;
      result.results.push({ fileName: file.fileName, fileId: null, success: false });

      await savePendingUpload({
        id: `pnd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        guestFolderId: guest.guestFolderId,
        fileName: file.fileName,
        dataUrl: file.dataUrl,
        createdAt: Date.now(),
      }).catch(() => {});
    }
  }

  return result;
}

export async function retryFailedUploads(clientId: string): Promise<void> {
  if (!clientId || !navigator.onLine) return;

  let token: string;
  try {
    token = await getValidToken(clientId);
  } catch {
    return;
  }

  const pending = await getAllPendingUploads().catch(() => []);
  for (const item of pending) {
    try {
      const existingRecord = await getExistingUpload(item.guestFolderId, item.fileName);
      if (existingRecord) {
        await deletePendingUpload(item.id);
        continue;
      }

      const fileId = await uploadFile(item.guestFolderId, item.fileName, item.dataUrl, token);

      await saveUploadRecord({
        id: `upl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        guestFolderId: item.guestFolderId,
        fileName: item.fileName,
        fileId,
        uploadedAt: Date.now(),
      });

      await deletePendingUpload(item.id);
    } catch {
      // will retry again next time
    }
  }
}
