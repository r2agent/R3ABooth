/* ============================================================
   STATUS SYNC — tulis & baca status tablet ke Firebase
   Dipakai untuk monitoring real-time di Web Operator
   ============================================================ */
import {
  ref,
  set,
  onValue,
  onDisconnect,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/database';
import { getFirebaseDb, isFirebaseConfigured } from './firebaseConfig';

/* ---------- TYPE ---------- */
export type TabletStatus = {
  deviceId: string;
  deviceName: string;
  currentEventSlug: string;
  currentEventName: string;
  currentPhase: string;
  sessionActive: boolean;
  photoCount: number;
  totalCaptures: number;
  lastActivity: number;
  online: boolean;
};

/* ---------- DEVICE ID ---------- */
/* Generate device ID unik per browser (persist di localStorage) */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'unknown';
  const KEY = 'r3a-device-id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `tablet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

/* ---------- DEVICE NAME ---------- */
export function getDeviceName(): string {
  const id = getDeviceId();
  // Coba ambil dari localStorage, kalau tidak ada pakai device ID
  const saved = localStorage.getItem('r3a-device-name');
  if (saved) return saved;
  // Default: "Tablet {short-id}"
  return `Tablet ${id.slice(-4).toUpperCase()}`;
}

export function setDeviceName(name: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('r3a-device-name', name);
}

/* ---------- PATH HELPER ---------- */
function statusPath(deviceId: string): string {
  return `status/${deviceId}`;
}

/* ============================================================
   WRITE STATUS — dipanggil dari PhotoboothSession
   ============================================================ */
export async function writeStatus(partial: Partial<TabletStatus>): Promise<void> {
  if (!isFirebaseConfigured()) return;

  try {
    const db = getFirebaseDb();
    const deviceId = getDeviceId();

    const status: TabletStatus = {
      deviceId,
      deviceName: getDeviceName(),
      currentEventSlug: partial.currentEventSlug ?? '',
      currentEventName: partial.currentEventName ?? '',
      currentPhase: partial.currentPhase ?? 'idle',
      sessionActive: partial.sessionActive ?? false,
      photoCount: partial.photoCount ?? 0,
      totalCaptures: partial.totalCaptures ?? 0,
      lastActivity: Date.now(),
      online: true,
    };

    await set(ref(db, statusPath(deviceId)), status);
  } catch {
    /* silent fail — jangan ganggu photobooth */
  }
}

/* ============================================================
   MARK OFFLINE — saat tab ditutup
   ============================================================ */
export function markOfflineOnDisconnect(): void {
  if (!isFirebaseConfigured()) return;
  try {
    const db = getFirebaseDb();
    const deviceId = getDeviceId();
    const statusRef = ref(db, statusPath(deviceId));
    // Firebase otomatis set online: false saat client disconnect
    onDisconnect(statusRef).set({
      deviceId,
      deviceName: getDeviceName(),
      currentEventSlug: '',
      currentEventName: '',
      currentPhase: 'offline',
      sessionActive: false,
      photoCount: 0,
      totalCaptures: 0,
      lastActivity: Date.now(),
      online: false,
    });
  } catch {
    /* silent fail */
  }
}

/* ============================================================
   SUBSCRIBE ALL TABLETS — dipanggil dari OperatorDashboard
   ============================================================ */
export function subscribeAllTablets(
  cb: (tablets: TabletStatus[]) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    return () => {};
  }
  const db = getFirebaseDb();
  return onValue(ref(db, 'status'), (snapshot) => {
    if (!snapshot.exists()) {
      cb([]);
      return;
    }
    const data = snapshot.val() as Record<string, TabletStatus>;
    const tablets = Object.values(data).sort(
      (a, b) => (b.lastActivity || 0) - (a.lastActivity || 0),
    );
    cb(tablets);
  });
}

/* ============================================================
   CLEAR STATUS — saat tablet exit
   ============================================================ */
export async function clearStatus(): Promise<void> {
  if (!isFirebaseConfigured()) return;
  try {
    const db = getFirebaseDb();
    const deviceId = getDeviceId();
    await set(ref(db, statusPath(deviceId)), null);
  } catch {
    /* silent fail */
  }
}

/* ---------- SERVER TIMESTAMP (kalau butuh) ---------- */
export function getServerTimestamp() {
  if (!isFirebaseConfigured()) return null;
  try {
    const db = getFirebaseDb();
    return serverTimestamp();
    void db;
  } catch {
    return null;
  }
}