/* ============================================================
   CLOUD EVENT SYNC — simpan & load event dari Firebase
   ============================================================ */
import {
  ref,
  set,
  get,
  remove,
  onValue,
  type Unsubscribe,
} from 'firebase/database';
import { getFirebaseDb, isFirebaseConfigured } from './firebaseConfig';
import type { R3aEvent } from './eventStore';

/* ---------- TYPE ---------- */
export type CloudEvent = R3aEvent & {
  slug: string;
  publishedAt: number;
};

/* ---------- SLUG GENERATOR ---------- */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/* ---------- PATH HELPER ---------- */
function eventPath(slug: string): string {
  return `events/${slug}`;
}

/* ---------- SAVE EVENT TO CLOUD ---------- */
export async function saveEventToCloud(
  event: R3aEvent,
): Promise<{ success: boolean; slug?: string; error?: string }> {
  if (!isFirebaseConfigured()) {
    return { success: false, error: 'Firebase belum dikonfigurasi' };
  }

  const slug = event.slug || generateSlug(event.eventName || 'untitled');
  if (!slug) {
    return { success: false, error: 'Slug tidak valid — isi nama event dulu' };
  }

  try {
    const db = getFirebaseDb();
    const now = Date.now();
    const existing = await get(ref(db, eventPath(slug)));
    const publishedAt = existing.exists()
      ? (existing.val() as CloudEvent).publishedAt
      : now;

    const payload: CloudEvent = {
      ...event,
      slug,
      publishedAt,
      updatedAt: now,
    };

    await set(ref(db, eventPath(slug)), payload);
    return { success: true, slug };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

/* ---------- PUBLISH EVENT TO CLOUD (alias, dipakai EventFile.tsx) ---------- */
export async function publishEventToCloud(
  event: R3aEvent,
): Promise<{ success: boolean; slug?: string; error?: string }> {
  return await saveEventToCloud(event);
}

/* ---------- LOAD EVENT ---------- */
export async function loadEventFromCloud(
  slug: string,
): Promise<CloudEvent | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const db = getFirebaseDb();
    const snapshot = await get(ref(db, eventPath(slug)));
    if (!snapshot.exists()) return null;
    return snapshot.val() as CloudEvent;
  } catch {
    return null;
  }
}

/* ---------- LIST ALL EVENTS ---------- */
export async function listEventsFromCloud(): Promise<CloudEvent[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const db = getFirebaseDb();
    const snapshot = await get(ref(db, 'events'));
    if (!snapshot.exists()) return [];
    const data = snapshot.val() as Record<string, CloudEvent>;
    return Object.values(data).sort(
      (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    );
  } catch {
    return [];
  }
}

/* ---------- DELETE EVENT ---------- */
export async function deleteEventFromCloud(slug: string): Promise<boolean> {
  if (!isFirebaseConfigured()) return false;
  try {
    const db = getFirebaseDb();
    await remove(ref(db, eventPath(slug)));
    return true;
  } catch {
    return false;
  }
}

/* ---------- REAL-TIME SUBSCRIBE ---------- */
export function subscribeEvent(
  slug: string,
  cb: (event: CloudEvent | null) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    return () => {};
  }
  const db = getFirebaseDb();
  return onValue(ref(db, eventPath(slug)), (snapshot) => {
    cb(snapshot.exists() ? (snapshot.val() as CloudEvent) : null);
  });
}

/* ---------- BUILD SHARE URL ---------- */
export function buildEventUrl(slug: string): string {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/${slug}`;
}

/* ---------- CHECK SLUG AVAILABLE ---------- */
export async function isSlugAvailable(slug: string): Promise<boolean> {
  if (!isFirebaseConfigured()) return false;
  try {
    const db = getFirebaseDb();
    const snapshot = await get(ref(db, eventPath(slug)));
    return !snapshot.exists();
  } catch {
    return false;
  }
}

/* ============================================================
   SYNC CLOUD → LOCAL — ambil event dari Firebase, merge ke IndexedDB
   ============================================================ */
export type SyncResult = {
  total: number;
  added: number;
  updated: number;
  skipped: number;
  errors: string[];
};

export async function syncCloudToLocal(
  saveLocalFn: (event: R3aEvent) => Promise<void>,
  getAllLocalFn: () => Promise<R3aEvent[]>,
): Promise<SyncResult> {
  const result: SyncResult = {
    total: 0,
    added: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  if (!isFirebaseConfigured()) {
    result.errors.push('Firebase belum dikonfigurasi');
    return result;
  }

  try {
    const cloudEvents = await listEventsFromCloud();
    result.total = cloudEvents.length;

    if (cloudEvents.length === 0) return result;

    const localEvents = await getAllLocalFn();
    const localById = new Map(localEvents.map((e) => [e.id, e]));
    const localBySlug = new Map(
      localEvents.filter((e) => e.slug).map((e) => [e.slug!, e]),
    );

    for (const cloudEvent of cloudEvents) {
      try {
        const eventToSave: R3aEvent = {
          id: cloudEvent.id,
          slug: cloudEvent.slug,
          eventName: cloudEvent.eventName,
          clientName: cloudEvent.clientName,
          date: cloudEvent.date,
          location: cloudEvent.location,
          frames: cloudEvent.frames,
          outputSettings: cloudEvent.outputSettings,
          printerSettings: cloudEvent.printerSettings,
          eventStatus: cloudEvent.eventStatus,
          createdAt: cloudEvent.createdAt,
          updatedAt: cloudEvent.updatedAt,
        };

        const existingById = localById.get(eventToSave.id);
        const existingBySlug = eventToSave.slug
          ? localBySlug.get(eventToSave.slug)
          : undefined;
        const existing = existingById || existingBySlug;

        if (!existing) {
          await saveLocalFn(eventToSave);
          result.added++;
        } else if ((eventToSave.updatedAt || 0) > (existing.updatedAt || 0)) {
          await saveLocalFn(eventToSave);
          result.updated++;
        } else {
          result.skipped++;
        }
      } catch (e) {
        result.errors.push(
          `Failed to sync ${cloudEvent.slug || cloudEvent.id}: ${
            e instanceof Error ? e.message : 'unknown error'
          }`,
        );
      }
    }

    return result;
  } catch (e) {
    result.errors.push(
      e instanceof Error ? e.message : 'Sync failed',
    );
    return result;
  }
}