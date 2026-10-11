/* ============================================================
   STATUS SYNC — tulis status device + command system ke Firebase
   ============================================================ */
import {
  ref,
  set,
  get,
  remove,
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
  /* Identitas device */
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
  /* Drive & upload status */
  driveConnected: boolean;
  driveAccount: string;
  uploadedCount: number;
  pendingCount: number;
  failedCount: number;
  /* Statistik hari ini */
  todaySessionCount: number;
  todayPhotoCount: number;
  /* NEW: storage info */
  storageFree: number;
  storageUsed: number;
  storageQuota: number;
};

/* ---------- COMMAND TYPE ---------- */
export type CommandType =
  | 'reload-app'
  | 'clear-cache'
  | 'retry-all'
  | 'reset-uptime'
  | 'clear-stats'
  | 'download-logs'
  | 'reconnect-drive';

export type DeviceCommand = {
  type: CommandType;
  issuedAt: number;
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

function commandPath(deviceId: string): string {
  return `commands/${deviceId}`;
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
      todaySessionCount: partial.todaySessionCount ?? 0,
      todayPhotoCount: partial.todayPhotoCount ?? 0,
      storageFree: partial.storageFree ?? 0,
      storageUsed: partial.storageUsed ?? 0,
      storageQuota: partial.storageQuota ?? 0,
    };

    await set(ref(db, statusPath(deviceId)), status);
  } catch { /* silent fail */ }
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
      todaySessionCount: 0,
      todayPhotoCount: 0,
      storageFree: 0,
      storageUsed: 0,
      storageQuota: 0,
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

/* ---------- SEND COMMAND ---------- */
export async function sendCommand(
  deviceId: string,
  type: CommandType,
): Promise<boolean> {
  if (!isFirebaseConfigured()) return false;
  try {
    const db = getFirebaseDb();
    const cmd: DeviceCommand = { type, issuedAt: Date.now() };
    await set(ref(db, commandPath(deviceId)), cmd);
    return true;
  } catch {
    return false;
  }
}

/* ---------- SUBSCRIBE COMMANDS ---------- */
export function subscribeCommands(
  deviceId: string,
  cb: (cmd: DeviceCommand | null) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) return () => {};
  const db = getFirebaseDb();
  return onValue(ref(db, commandPath(deviceId)), (snapshot) => {
    if (!snapshot.exists()) {
      cb(null);
      return;
    }
    cb(snapshot.val() as DeviceCommand);
  });
}

/* ---------- CLEAR COMMAND ---------- */
export async function clearCommand(deviceId: string): Promise<void> {
  if (!isFirebaseConfigured()) return;
  try {
    const db = getFirebaseDb();
    await remove(ref(db, commandPath(deviceId)));
  } catch { /* silent fail */ }
}

/* ---------- GET DEVICE STATUS ---------- */
export async function getDeviceStatus(deviceId: string): Promise<TabletStatus | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const db = getFirebaseDb();
    const snap = await get(ref(db, statusPath(deviceId)));
    return snap.exists() ? (snap.val() as TabletStatus) : null;
  } catch {
    return null;
  }
}

/* ---------- STORAGE ESTIMATE HELPER ---------- */
export async function getStorageEstimate(): Promise<{ free: number; used: number; quota: number }> {
  try {
    type StorageEstimate = { quota?: number; usage?: number };
    const nav = navigator as Navigator & { storage?: { estimate?: () => Promise<StorageEstimate> } };
    if (!nav.storage || !nav.storage.estimate) {
      return { free: 0, used: 0, quota: 0 };
    }
    const est = await nav.storage.estimate();
    const quota = est.quota ?? 0;
    const used = est.usage ?? 0;
    const free = quota - used;
    return { free, used, quota };
  } catch {
    return { free: 0, used: 0, quota: 0 };
  }
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