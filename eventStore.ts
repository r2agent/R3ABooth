export type Slot = {
  id: string;
  captureId: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Frame = {
  id: string;
  name: string;
  image: string;
  slots: Slot[];
};

export type OutputSettings = {
  destinationFolder: string;
  fileNaming: string;
  savePhotos: boolean;
  saveVideos: boolean;
};

export type PrinterSettings = {
  printer: string;
  paperSize: string;
  copies: number;
};

export type EventStatus = 'Ready' | 'Active' | 'Ended';

export type R3aEvent = {
  id: string;
  eventName: string;
  clientName: string;
  date: string;
  location: string;
  frames: Frame[];
  outputSettings: OutputSettings;
  printerSettings: PrinterSettings;
  eventStatus: EventStatus;
  createdAt: number;
  updatedAt: number;
};

const DB_NAME = 'r3a-booth';
const STORE_NAME = 'events';
const CAPTURES_STORE = 'captures';
const DB_VERSION = 3;

let dbPromise: Promise<IDBDatabase> | null = null;

function normalizeSlot(slot: Partial<Slot> | null | undefined, index: number): Slot {
  const value = (candidate: unknown, fallback: number): number => {
    const parsed = typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback;
    return Math.max(0, Math.min(100, parsed));
  };
  const x = value(slot?.x, 10);
  const y = value(slot?.y, 10);
  const w = Math.max(5, Math.min(100 - x, value(slot?.w, 30)));
  const h = Math.max(5, Math.min(100 - y, value(slot?.h, 30)));
  return {
    id: typeof slot?.id === 'string' && slot.id ? slot.id : `slt-legacy-${index}`,
    captureId: typeof slot?.captureId === 'string' && slot.captureId ? slot.captureId : `cap-${index + 1}`,
    x,
    y,
    w,
    h,
  };
}

function normalizeFrame(frame: Partial<Frame> | null | undefined, index: number): Frame {
  return {
    id: typeof frame?.id === 'string' && frame.id ? frame.id : `frm-legacy-${index}`,
    name: typeof frame?.name === 'string' && frame.name ? frame.name : `Frame ${index + 1}`,
    image: typeof frame?.image === 'string' ? frame.image : '',
    slots: Array.isArray(frame?.slots) ? frame.slots.map((slot, slotIndex) => normalizeSlot(slot, slotIndex)) : [],
  };
}

function normalizeEvent(value: Partial<R3aEvent> | null | undefined): R3aEvent {
  const now = Date.now();
  return {
    id: typeof value?.id === 'string' && value.id ? value.id : `evt-legacy-${now}`,
    eventName: typeof value?.eventName === 'string' ? value.eventName : '',
    clientName: typeof value?.clientName === 'string' ? value.clientName : '',
    date: typeof value?.date === 'string' ? value.date : '',
    location: typeof value?.location === 'string' ? value.location : '',
    frames: Array.isArray(value?.frames) ? value.frames.map((frame, index) => normalizeFrame(frame, index)) : [],
    outputSettings: {
      destinationFolder: typeof value?.outputSettings?.destinationFolder === 'string' ? value.outputSettings.destinationFolder : '',
      fileNaming: typeof value?.outputSettings?.fileNaming === 'string' ? value.outputSettings.fileNaming : '{event}_{date}_{number}',
      savePhotos: value?.outputSettings?.savePhotos !== false,
      saveVideos: value?.outputSettings?.saveVideos === true,
    },
    printerSettings: {
      printer: typeof value?.printerSettings?.printer === 'string' ? value.printerSettings.printer : 'No printer selected',
      paperSize: typeof value?.printerSettings?.paperSize === 'string' ? value.printerSettings.paperSize : '4 × 6 in',
      copies: typeof value?.printerSettings?.copies === 'number' && Number.isFinite(value.printerSettings.copies) ? value.printerSettings.copies : 1,
    },
    eventStatus: value?.eventStatus === 'Active' || value?.eventStatus === 'Ended' ? value.eventStatus : 'Ready',
    createdAt: typeof value?.createdAt === 'number' ? value.createdAt : now,
    updatedAt: typeof value?.updatedAt === 'number' ? value.updatedAt : now,
  };
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CAPTURES_STORE)) {
        db.createObjectStore(CAPTURES_STORE, { keyPath: 'id' });
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

export async function getAllEvents(): Promise<R3aEvent[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as unknown[]).map((event) => normalizeEvent(event as Partial<R3aEvent>)).sort((a, b) => b.updatedAt - a.updatedAt));
    req.onerror = () => reject(req.error);
  });
}

export async function getEvent(id: string): Promise<R3aEvent | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result ? normalizeEvent(req.result as Partial<R3aEvent>) : undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function saveEvent(event: R3aEvent): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(event);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteEvent(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function createEmptyEvent(): R3aEvent {
  const now = Date.now();
  return {
    id: `evt-${now}-${Math.random().toString(36).slice(2, 8)}`,
    eventName: '',
    clientName: '',
    date: '',
    location: '',
    frames: [],
    outputSettings: {
      destinationFolder: '',
      fileNaming: '{event}_{date}_{number}',
      savePhotos: true,
      saveVideos: false,
    },
    printerSettings: {
      printer: 'No printer selected',
      paperSize: '4 × 6 in',
      copies: 1,
    },
    eventStatus: 'Ready',
    createdAt: now,
    updatedAt: now,
  };
}

export function createFrame(name: string, image: string): Frame {
  return {
    id: `frm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    image,
    slots: [],
  };
}

export function createSlot(captureId: string): Slot {
  return {
    id: `slt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    captureId,
    x: 10,
    y: 10,
    w: 30,
    h: 30,
  };
}

export function duplicateSlot(slot: Slot): Slot {
  return {
    ...slot,
    id: `slt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    x: Math.min(slot.x + 5, 100 - slot.w),
    y: Math.min(slot.y + 5, 100 - slot.h),
  };
}
