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
  deviceType: string;
  browser: string;
  os: string;
  screenSize: string;
  currentEventSlug: string;
  currentEventName: string;
  currentPhase: string;
  sessionActive: boolean;
  photoCount: number;
  totalCaptures: number;
  eventOpenedAt: number;
  lastActivity: number;
  online: boolean;
  driveConnected: boolean;
  driveAccount: string;
  driveTokenExpiresAt: number;
  driveUsage: number;
  driveLimit: number;
  uploadedCount: number;
  pendingCount: number;
  failedCount: number;
  todaySessionCount: number;
  todayPhotoCount: number;
  qrHistory?: { id: string; url: string; type: string; time: number }[]; // ⚡ BARU
};

/* ---------- COMMAND TYPE ---------- */
export type CommandType =
  | 'reload-app'
  | 'clear-cache'
  | 'retry-all'
  | 'reset-uptime'
  | 'clear-stats'
  | 'download-logs'
  | 'reconnect-drive'
  | 'force-fullscreen'
  | 'refresh-token'
  | 'rename-device';

export type DeviceCommand = {
  type: CommandType;
  issuedAt: number;
  payload?: string;
};

/* ---------- DEVICE ID ---------- */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'unknown';
  const KEY = 'r3a-device-id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `device-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

/* ---------- AUTO DEVICE NAME ---------- */
export function getAutoDeviceName(): string {
  const info = getDeviceInfo();
  const typeLabel =
    info.deviceType === 'mobile' ? 'HP'
    : info.deviceType === 'tablet' ? 'Tablet'
    : 'PC';
  return `${info.browser} - ${typeLabel} - ${info.os}`;
}

export function getDeviceName(): string {
  const custom = typeof window !== 'undefined' ? localStorage.getItem('r3a-device-name') : null;
  if (custom) return custom;
  return getAutoDeviceName();
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
      eventOpenedAt: partial.eventOpenedAt ?? 0,
      lastActivity: Date.now(),
      online: true,
      driveConnected: partial.driveConnected ?? false,
      driveAccount: partial.driveAccount ?? '',
      driveTokenExpiresAt: partial.driveTokenExpiresAt ?? 0,
      driveUsage: partial.driveUsage ?? 0,
      driveLimit: partial.driveLimit ?? 0,
      uploadedCount: partial.uploadedCount ?? 0,
      pendingCount: partial.pendingCount ?? 0,
      failedCount: partial.failedCount ?? 0,
      todaySessionCount: partial.todaySessionCount ?? 0,
      todayPhotoCount: partial.todayPhotoCount ?? 0,
      qrHistory: partial.qrHistory ?? [],
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
      eventOpenedAt: 0,
      lastActivity: Date.now(),
      online: false,
      driveConnected: false,
      driveAccount: '',
      driveTokenExpiresAt: 0,
      driveUsage: 0,
      driveLimit: 0,
      uploadedCount: 0,
      pendingCount: 0,
      failedCount: 0,
      todaySessionCount: 0,
      todayPhotoCount: 0,
      qrHistory: [], // Biarkan kosong saat offline
    });
  } catch { /* silent fail */ }
}

/* ---------- SUBSCRIBE ALL ---------- */
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
    const tablets = Object.values(data).sort((a, b) =>
      (a.deviceId || '').localeCompare(b.deviceId || ''),
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

/* ---------- DELETE DEVICE (Khusus Operator) ---------- */
export async function deleteDevice(deviceId: string): Promise<boolean> {
  if (!isFirebaseConfigured()) return false;
  try {
    const db = getFirebaseDb();
    await remove(ref(db, statusPath(deviceId)));
    await remove(ref(db, commandPath(deviceId)));
    return true;
  } catch {
    return false;
  }
}

/* ---------- SEND COMMAND ---------- */
export async function sendCommand(
  deviceId: string,
  type: CommandType,
  payload?: string,
): Promise<boolean> {
  if (!isFirebaseConfigured()) return false;
  try {
    const db = getFirebaseDb();
    const cmd: DeviceCommand = { type, issuedAt: Date.now() };
    if (payload !== undefined) cmd.payload = payload;
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

/* ---------- DRIVE QUOTA ---------- */
export async function getDriveQuota(): Promise<{ usage: number; limit: number }> {
  try {
    const token = await getValidTokenCached();
    if (!token) return { usage: 0, limit: 0 };

    const res = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=storageQuota',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return { usage: 0, limit: 0 };

    const data = await res.json() as {
      storageQuota?: { usage?: string; limit?: string };
    };
    const usage = Number(data.storageQuota?.usage ?? 0);
    const limit = Number(data.storageQuota?.limit ?? 0);
    return { usage, limit };
  } catch {
    return { usage: 0, limit: 0 };
  }
}

async function getValidTokenCached(): Promise<string | null> {
  try {
    const { getValidToken } = await import('./gdriveService');
    const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || '';
    if (!clientId) return null;
    const token = await getValidToken(clientId);
    return token || null;
  } catch {
    return null;
  }
}

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