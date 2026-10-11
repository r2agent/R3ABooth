/* ============================================================
   STATUS SYNC — tulis & baca status device ke Firebase
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
import { getDeviceInfo } from './deviceInfo';

/* ---------- TYPE ---------- */
export type TabletStatus = {
  deviceId: string;
  deviceName: string;
  /* NEW: identitas device */
  deviceType: string;
  browser: string;
  os: string;
  screenSize: string;
  /* Event & session */
  currentEventSlug: string;
  currentEventName: string;
  currentPhase: string;
  sessionActive: boolean;
  photoCount: number;
  totalCaptures: number;
  lastActivity: number;
  online: boolean;
  /* NEW: drive & upload status */
  driveConnected: boolean;
  driveAccount: string;
  uploadedCount: number;
  pendingCount: number;
  failedCount: number;
};

/* ---------- DEVICE ID ---------- */
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
  const saved = localStorage.getItem('r3a-device-name');
  if (saved) return saved;
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

/* ---------- WRITE STATUS ---------- */
export async function writeStatus(partial: Partial<TabletStatus>): Promise<void> {
  if (!isFirebaseConfigured()) return;

  try {
    const db = getFirebaseDb();
    const deviceId = getDeviceId();
    const info = getDeviceInfo();

    const status: TabletStatus = {
      deviceId,
      deviceName: getDeviceName(),
      deviceType: partial.deviceType ?? info.deviceType,
      browser: partial.browser ?? info.browser,
      os: partial.os ?? info.os,
      screenSize: partial.screenSize ?? info.screenSize,
      currentEventSlug: partial.currentEventSlug ?? '',
      currentEventName: partial.currentEventName ?? '',
      currentPhase: partial.currentPhase ?? 'idle',
      sessionActive: partial.sessionActive ?? false,
      photoCount: partial.photoCount ?? 0,
      totalCaptures: partial.totalCaptures ?? 0,
      lastActivity: Date.now(),
      online: true,
      driveConnected: partial.driveConnected ?? false,
      driveAccount: partial.driveAccount ?? '',
      uploadedCount: partial.uploadedCount ?? 0,
      pendingCount: partial.pendingCount ?? 0,
      failedCount: partial.failedCount ?? 0,
    };

    await set(ref(db, statusPath(deviceId)), status);
  } catch {
    /* silent fail */
  }
}

/* ---------- MARK OFFLINE ---------- */
export function markOfflineOnDisconnect(): void {
  if (!isFirebaseConfigured()) return;
  try {
    const db = getFirebaseDb();
    const deviceId = getDeviceId();
    const info = getDeviceInfo();
    const statusRef = ref(db, statusPath(deviceId));
    onDisconnect(statusRef).set({
      deviceId,
      deviceName: getDeviceName(),
      deviceType: info.deviceType,
      browser: info.browser,
      os: info.os,
      screenSize: info.screenSize,
      currentEventSlug: '',
      currentEventName: '',
      currentPhase: 'offline',
      sessionActive: false,
      photoCount: 0,
      totalCaptures: 0,
      lastActivity: Date.now(),
      online: false,
      driveConnected: false,
      driveAccount: '',
      uploadedCount: 0,
      pendingCount: 0,
      failedCount: 0,
    });
  } catch { /* silent fail */ }
}

/* ---------- SUBSCRIBE ALL DEVICES ---------- */
export function subscribeAllTablets(
  cb: (tablets: TabletStatus[]) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) return () => {};
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

/* ---------- CLEAR STATUS ---------- */
export async function clearStatus(): Promise<void> {
  if (!isFirebaseConfigured()) return;
  try {
    const db = getFirebaseDb();
    const deviceId = getDeviceId();
    await set(ref(db, statusPath(deviceId)), null);
  } catch { /* silent fail */ }
}

/* ---------- SERVER TIMESTAMP ---------- */
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