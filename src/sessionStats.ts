/* ============================================================
   SESSION STATS — track statistik sesi photobooth
   Pakai localStorage untuk persist antar reload.
   ============================================================ */

const STATS_KEY = 'r3a-session-stats-v1';

export type SessionRecord = {
  id: string;
  eventId: string;
  startedAt: number;
  finishedAt: number;
  photoCount: number;
  uploadSuccess: number;
  uploadFail: number;
};

type StatsStore = {
  sessions: SessionRecord[];
  appStartedAt: number;
};

function loadStore(): StatsStore {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return { sessions: [], appStartedAt: Date.now() };
    const parsed = JSON.parse(raw) as StatsStore;
    if (!Array.isArray(parsed.sessions)) parsed.sessions = [];
    if (!parsed.appStartedAt) parsed.appStartedAt = Date.now();
    return parsed;
  } catch {
    return { sessions: [], appStartedAt: Date.now() };
  }
}

function saveStore(store: StatsStore): void {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

/* ---------- RECORD ---------- */
export function recordSession(record: SessionRecord): void {
  const store = loadStore();
  store.sessions.push(record);
  // Keep max 500 records
  if (store.sessions.length > 500) {
    store.sessions = store.sessions.slice(-500);
  }
  saveStore(store);
}

/* ---------- QUERY ---------- */
function isSameDay(ts: number, ref: Date): boolean {
  const d = new Date(ts);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

export type TodayStats = {
  sessionCount: number;
  photoCount: number;
  uploadSuccess: number;
  uploadFail: number;
  avgDurationMs: number;
};

export function getTodayStats(): TodayStats {
  const store = loadStore();
  const today = new Date();
  const todaySessions = store.sessions.filter((s) => isSameDay(s.startedAt, today));
  const sessionCount = todaySessions.length;
  const photoCount = todaySessions.reduce((acc, s) => acc + s.photoCount, 0);
  const uploadSuccess = todaySessions.reduce((acc, s) => acc + s.uploadSuccess, 0);
  const uploadFail = todaySessions.reduce((acc, s) => acc + s.uploadFail, 0);
  const totalDuration = todaySessions.reduce(
    (acc, s) => acc + (s.finishedAt - s.startedAt),
    0,
  );
  const avgDurationMs = sessionCount > 0 ? totalDuration / sessionCount : 0;

  return {
    sessionCount,
    photoCount,
    uploadSuccess,
    uploadFail,
    avgDurationMs,
  };
}

export function getLastSession(): SessionRecord | null {
  const store = loadStore();
  if (store.sessions.length === 0) return null;
  return store.sessions[store.sessions.length - 1];
}

export function getAppUptimeMs(): number {
  const store = loadStore();
  return Date.now() - store.appStartedAt;
}

export function resetAppUptime(): void {
  const store = loadStore();
  store.appStartedAt = Date.now();
  saveStore(store);
}

export function clearAllStats(): void {
  try {
    localStorage.removeItem(STATS_KEY);
  } catch {
    /* ignore */
  }
}