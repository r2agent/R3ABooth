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

/* ---------- SAVE EVENT ---------- */
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