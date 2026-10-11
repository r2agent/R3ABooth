/* ============================================================
   DEVICE DIAGNOSTIC — cek status device untuk Operator Dashboard
   ============================================================ */

export type DeviceCheckStatus = 'ok' | 'warning' | 'error' | 'checking' | 'unknown';

export type DeviceCheck = {
  id: string;
  label: string;
  status: DeviceCheckStatus;
  detail: string;
};

/* ---------- KAMERA ---------- */
export async function checkCamera(): Promise<DeviceCheck> {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return {
        id: 'camera',
        label: 'Camera',
        status: 'error',
        detail: 'Browser tidak mendukung kamera',
      };
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((d) => d.kind === 'videoinput');
    if (cameras.length === 0) {
      return {
        id: 'camera',
        label: 'Camera',
        status: 'error',
        detail: 'Tidak ada kamera terdeteksi',
      };
    }
    return {
      id: 'camera',
      label: 'Camera',
      status: 'ok',
      detail: `${cameras.length} device terdeteksi`,
    };
  } catch (e) {
    return {
      id: 'camera',
      label: 'Camera',
      status: 'error',
      detail: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

/* ---------- INTERNET ---------- */
export async function checkInternet(): Promise<DeviceCheck> {
  if (!navigator.onLine) {
    return {
      id: 'internet',
      label: 'Internet',
      status: 'error',
      detail: 'Offline',
    };
  }
  const start = performance.now();
  try {
    // Ping ke Google favicon (file kecil, cepat)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch('https://www.google.com/favicon.ico', {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const latency = Math.round(performance.now() - start);
    return {
      id: 'internet',
      label: 'Internet',
      status: latency < 1000 ? 'ok' : 'warning',
      detail: `Online (${latency}ms)`,
    };
  } catch {
    return {
      id: 'internet',
      label: 'Internet',
      status: 'warning',
      detail: 'Ping timeout',
    };
  }
}

/* ---------- STORAGE ---------- */
export async function checkStorage(): Promise<DeviceCheck> {
  try {
    type StorageEstimate = { quota?: number; usage?: number };
    const nav = navigator as Navigator & { storage?: { estimate?: () => Promise<StorageEstimate> } };
    if (!nav.storage || !nav.storage.estimate) {
      return {
        id: 'storage',
        label: 'Storage',
        status: 'unknown',
        detail: 'Tidak bisa cek storage',
      };
    }
    const est = await nav.storage.estimate();
    const quota = est.quota ?? 0;
    const usage = est.usage ?? 0;
    const free = quota - usage;
    const freeGB = (free / (1024 * 1024 * 1024)).toFixed(2);
    const usagePercent = quota > 0 ? (usage / quota) * 100 : 0;

    let status: DeviceCheckStatus = 'ok';
    if (usagePercent > 90) status = 'error';
    else if (usagePercent > 75) status = 'warning';

    return {
      id: 'storage',
      label: 'Storage',
      status,
      detail: `${freeGB} GB free (${usagePercent.toFixed(0)}% used)`,
    };
  } catch {
    return {
      id: 'storage',
      label: 'Storage',
      status: 'unknown',
      detail: 'Gagal cek storage',
    };
  }
}

/* ---------- PRINTER ---------- */
export function checkPrinter(): DeviceCheck {
  // Browser tidak bisa akses status printer secara langsung.
  // Kita cek ketersediaan API print.
  const hasPrint = typeof window.print === 'function';
  return {
    id: 'printer',
    label: 'Printer',
    status: hasPrint ? 'ok' : 'error',
    detail: hasPrint ? 'Print API tersedia' : 'Print tidak didukung',
  };
}

/* ---------- MEMORY ---------- */
export function checkMemory(): DeviceCheck {
  type PerformanceMemory = {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
  const perf = performance as Performance & { memory?: PerformanceMemory };
  if (!perf.memory) {
    return {
      id: 'memory',
      label: 'Memory',
      status: 'unknown',
      detail: 'Memory API tidak tersedia',
    };
  }
  const usedMB = perf.memory.usedJSHeapSize / (1024 * 1024);
  const limitMB = perf.memory.jsHeapSizeLimit / (1024 * 1024);
  const percent = (usedMB / limitMB) * 100;

  let status: DeviceCheckStatus = 'ok';
  if (percent > 90) status = 'error';
  else if (percent > 75) status = 'warning';

  return {
    id: 'memory',
    label: 'Memory',
    status,
    detail: `${usedMB.toFixed(0)} / ${limitMB.toFixed(0)} MB (${percent.toFixed(0)}%)`,
  };
}

/* ---------- FULL DIAGNOSTIC ---------- */
export async function runFullDiagnostic(): Promise<DeviceCheck[]> {
  const results = await Promise.all([
    checkCamera(),
    checkInternet(),
    checkStorage(),
  ]);
  return [
    ...results,
    checkPrinter(),
    checkMemory(),
  ];
}

/* ---------- HELPERS ---------- */
export function getSystemInfo(): { label: string; value: string }[] {
  const ua = navigator.userAgent;
  let browser = 'Unknown';
  if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Safari')) browser = 'Safari';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Edge')) browser = 'Edge';

  let os = 'Unknown';
  if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPad') || ua.includes('iPhone')) os = 'iOS';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';

  return [
    { label: 'Browser', value: browser },
    { label: 'OS', value: os },
    { label: 'Screen', value: `${window.screen.width}x${window.screen.height}` },
    { label: 'Viewport', value: `${window.innerWidth}x${window.innerHeight}` },
    { label: 'DPR', value: String(window.devicePixelRatio) },
    { label: 'Online', value: navigator.onLine ? 'Yes' : 'No' },
    { label: 'Language', value: navigator.language },
    { label: 'User Agent', value: ua.slice(0, 80) + '...' },
  ];
}

/* ---------- LOG BUFFER ---------- */
export type LogEntry = {
  time: number;
  level: 'info' | 'warn' | 'error';
  message: string;
};

const logBuffer: LogEntry[] = [];
const MAX_LOG = 100;

export function pushLog(level: LogEntry['level'], message: string): void {
  logBuffer.push({ time: Date.now(), level, message });
  if (logBuffer.length > MAX_LOG) logBuffer.shift();
}

export function getLogs(): LogEntry[] {
  return [...logBuffer].reverse();
}

export function clearLogs(): void {
  logBuffer.length = 0;
}

export function downloadLogs(): void {
  const text = getLogs()
    .map((l) => `[${new Date(l.time).toISOString()}] [${l.level.toUpperCase()}] ${l.message}`)
    .join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `r3a-logs-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}