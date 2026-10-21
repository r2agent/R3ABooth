import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  RefreshCw,
  X,
  ChevronLeft,
  AlertCircle,
  CheckCircle2,
  Plug,
  HardDrive,
  Play,
  Trash2,
  Download,
  RotateCcw,
  Smartphone,
  Tablet,
  Monitor,
  Globe,
  Key,
  Maximize2,
  Edit3,
  Zap,
  Sun,
  Moon,
  ArrowLeft,
  QrCode,
  ExternalLink,
  ShieldAlert,
  FileSpreadsheet,
  Wrench,
  Lock,
  Unlock,
  Printer,
  Bell,
  Activity,
  Battery,
  BatteryCharging,
  Database,
  Link2,
  Copy,
} from 'lucide-react';
import type { AllSettings } from '../settingsStore';
import {
  subscribeAllTablets,
  sendCommand,
  deleteDevice,
  type TabletStatus,
  type CommandType,
} from '../statusSync';
import { formatDeviceType } from '../deviceInfo';

/* ---------- HELPERS ---------- */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}m ${remSec}s`;
  const hour = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hour}h ${remMin}m`;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

function formatTokenExpiry(expiresAt: number): string {
  if (!expiresAt || expiresAt <= 0) return '—';
  const diff = expiresAt - Date.now();
  if (diff <= 0) return '⚠️ EXPIRED';
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min} menit lagi`;
  const hour = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hour}j ${remMin}m lagi`;
}

function deviceTypeIcon(type: string, size = 16) {
  if (type === 'mobile') return <Smartphone size={size} />;
  if (type === 'tablet') return <Tablet size={size} />;
  return <Monitor size={size} />;
}

function generateSparklinePoints(data: number[], width = 100, height = 28): string {
  if (data.length === 0) return '';
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  
  return data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function getGraphData(value: number): string {
  const length = 12;
  if (value === 0) return generateSparklinePoints(Array(length).fill(0));
  
  const data = [0];
  let current = 0;
  for (let i = 1; i < length - 1; i++) {
    const step = Math.max(1, Math.round(value / (length / 2)));
    current += Math.random() > 0.3 ? step : 0; 
    if (current > value) current = value;
    data.push(current);
  }
  data.push(value);
  return generateSparklinePoints(data);
}

function timeAgo(ts: number): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60000) return `${Math.floor(diff / 1000)}s lalu`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m lalu`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}j lalu`;
  return `${Math.floor(diff / 86400000)}h lalu`;
}

const THEME_KEY = 'r3a-op-theme';

/* ---------- COMPONENT ---------- */
export const OperatorDashboard = ({
  allSettings,
  eventSlug,
  onClose,
  onBackToPhotobooth,
  focusDeviceId,
}: {
  allSettings: AllSettings;
  eventSlug?: string;
  onClose: () => void;
  onBackToPhotobooth?: () => void;
  focusDeviceId?: string;
}) => {
  const [, setTick] = useState(0);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* ignore */ }
    return 'dark';
  });

  const [tablets, setTablets] = useState<TabletStatus[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState<string>('');
  const [renaming, setRenaming] = useState(false);
  const [deviceFilter, setDeviceFilter] = useState<'all' | 'online' | 'offline'>('all');
  const isSecondaryAdmin = !!focusDeviceId;
  const focusAppliedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = subscribeAllTablets((newTablets) => {
      setTablets(newTablets);
    });
    return unsubscribe;
  }, []);

  // ⚡ Auto-select device dari #operator/DEVICE_ID
  useEffect(() => {
    if (focusAppliedRef.current) return;
    if (!focusDeviceId) return;
    const found = tablets.find((t) => t.deviceId === focusDeviceId);
    if (found) {
      setSelectedDeviceId(focusDeviceId);
      focusAppliedRef.current = true;
    }
  }, [focusDeviceId, tablets]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    setRenameInput('');
    setRenaming(false);
  }, [selectedDeviceId]);

  const eventFiltered = eventSlug
    ? tablets.filter((t) => t.currentEventSlug === eventSlug)
    : tablets;

  const isDeviceOnline = (t: TabletStatus): boolean => {
    const lastActivityAgo = Math.floor((Date.now() - t.lastActivity) / 1000);
    const isStale = lastActivityAgo > 60;
    return t.online && !isStale;
  };

  const onlineCount = eventFiltered.filter(isDeviceOnline).length;
  const offlineCount = eventFiltered.length - onlineCount;

  const filteredTablets = deviceFilter === 'all'
    ? eventFiltered
    : deviceFilter === 'online'
      ? eventFiltered.filter(isDeviceOnline)
      : eventFiltered.filter((t) => !isDeviceOnline(t));

  const selectedDevice = eventFiltered.find((t) => t.deviceId === selectedDeviceId) ?? null;

  const aggregatedStats = useMemo(() => {
    let totalSessions = 0, totalPhotos = 0, totalUploaded = 0, totalPending = 0, totalFailed = 0;
    let driveUsed = 0, driveLimit = 0, driveConnectedCount = 0;
    let totalAlerts = 0;
    for (const t of eventFiltered) {
      totalSessions += t.todaySessionCount ?? 0;
      totalPhotos += t.todayPhotoCount ?? 0;
      totalUploaded += t.uploadedCount ?? 0;
      totalPending += t.pendingCount ?? 0;
      totalFailed += t.failedCount ?? 0;
      totalAlerts += (t.alerts ?? []).length;
      if (t.driveConnected && t.driveLimit > 0) {
        driveConnectedCount++;
        driveUsed += t.driveUsage ?? 0;
        driveLimit += t.driveLimit ?? 0;
      }
    }
    const pricePerSession = allSettings.payment?.price || 25000;
    const totalRevenue = totalSessions * pricePerSession;

    return {
      totalSessions, totalPhotos, totalUploaded, totalPending, totalFailed,
      driveUsed, driveLimit, driveConnectedCount, totalRevenue, totalAlerts,
    };
  }, [eventFiltered, allSettings.payment?.price]);

  const displayStats = useMemo(() => {
    if (selectedDevice) {
      const price = allSettings.payment?.price || 25000;
      return {
        totalSessions: selectedDevice.todaySessionCount ?? 0,
        totalPhotos: selectedDevice.todayPhotoCount ?? 0,
        totalRevenue: (selectedDevice.todaySessionCount ?? 0) * price,
        totalFailed: selectedDevice.failedCount ?? 0,
      };
    }
    return aggregatedStats;
  }, [selectedDevice, aggregatedStats, allSettings.payment?.price]);

  useEffect(() => {
    const originalMinWidth = document.body.style.minWidth;
    const originalOverflow = document.body.style.overflow;
    document.body.style.minWidth = '0';
    document.body.style.overflow = 'auto';
    return () => {
      document.body.style.minWidth = originalMinWidth;
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  useEffect(() => {
    if (!actionMessage) return;
    const t = setTimeout(() => setActionMessage(null), 4000);
    return () => clearTimeout(t);
  }, [actionMessage]);

  const handleCommand = useCallback(async (type: CommandType, label: string) => {
    if (!selectedDevice) {
      setActionMessage('Pilih device dulu.');
      return;
    }
    const ok = await sendCommand(selectedDevice.deviceId, type);
    if (ok) setActionMessage(`✅ Perintah "${label}" dikirim ke ${selectedDevice.browser}.`);
    else setActionMessage(`❌ Gagal kirim perintah.`);
  }, [selectedDevice]);

  const handleCommandWithPayload = useCallback(async (type: CommandType, payload: string, label: string) => {
    if (!selectedDevice) {
      setActionMessage('Pilih device dulu.');
      return;
    }
    const ok = await sendCommand(selectedDevice.deviceId, type, payload);
    if (ok) setActionMessage(`✅ Perintah "${label}" dikirim ke ${selectedDevice.browser}.`);
    else setActionMessage(`❌ Gagal kirim perintah.`);
  }, [selectedDevice]);

  const handleRename = useCallback(async () => {
    if (!selectedDevice) {
      setActionMessage('Pilih device dulu.');
      return;
    }
    const newName = renameInput.trim();
    if (!newName) {
      setActionMessage('❌ Nama tidak boleh kosong.');
      return;
    }
    if (newName === selectedDevice.deviceName) {
      setActionMessage('⚠️ Nama sama dengan yang sekarang.');
      return;
    }

    setRenaming(true);
    const ok = await sendCommand(selectedDevice.deviceId, 'rename-device', newName);
    setRenaming(false);

    if (ok) {
      setActionMessage(`✅ Rename dikirim. Device akan update dalam ~5 detik.`);
      setRenameInput('');
      setTablets((prev) => prev.map((t) =>
        t.deviceId === selectedDevice.deviceId ? { ...t, deviceName: newName } : t
      ));
    } else {
      setActionMessage('❌ Gagal kirim perintah rename.');
    }
  }, [selectedDevice, renameInput]);

  const handleDeleteDevice = useCallback(async (deviceId: string) => {
    if (!window.confirm('Hapus device ini dari daftar? Device akan muncul lagi jika dia online.')) return;
    const ok = await deleteDevice(deviceId);
    if (ok) {
      setActionMessage('✅ Device berhasil dihapus dari daftar.');
      setSelectedDeviceId(null);
    } else {
      setActionMessage('❌ Gagal menghapus device.');
    }
  }, []);

  const handleCopyAdminLink = useCallback(async () => {
    if (!selectedDevice) return;
    const url = `${window.location.origin}/#operator/${selectedDevice.deviceId}`;
    try {
      await navigator.clipboard.writeText(url);
      setActionMessage(`✅ Link admin dikopi:\n${url}`);
    } catch {
      setActionMessage(`Link: ${url}`);
    }
  }, [selectedDevice]);

  const handleExportCSV = useCallback(() => {
    const headers = ['Metric', 'Value'];
    const rows = [
      ['Total Sesi Hari Ini', displayStats.totalSessions],
      ['Total Foto Hari Ini', displayStats.totalPhotos],
      ['Total Pendapatan', displayStats.totalRevenue],
      ['Failed Uploads', displayStats.totalFailed],
      ['Total Alerts', aggregatedStats.totalAlerts],
      ['Time Exported', new Date().toISOString()]
    ];

    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `r3a_stats_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [displayStats, aggregatedStats.totalAlerts]);

  const drivePercent = aggregatedStats.driveLimit > 0
    ? (aggregatedStats.driveUsed / aggregatedStats.driveLimit) * 100
    : 0;

  const latestQr = selectedDevice?.qrHistory && selectedDevice.qrHistory.length > 0 
    ? selectedDevice.qrHistory[selectedDevice.qrHistory.length - 1] 
    : null;
    
  const previousQrs = selectedDevice?.qrHistory && selectedDevice.qrHistory.length > 1
    ? selectedDevice.qrHistory.slice(0, -1).reverse()
    : [];

  const deviceAlerts = selectedDevice?.alerts ?? [];
  const deviceActivity = selectedDevice?.activityLog ?? [];
  const batteryPct = selectedDevice?.batteryLevel ?? 0;
  const storagePct = selectedDevice && selectedDevice.storageQuota > 0
    ? ((selectedDevice.storageUsage ?? 0) / selectedDevice.storageQuota) * 100
    : 0;

  return (
    <>
      <style>{`
        body:has(.operator-dashboard) { min-width: 0 !important; overflow: auto !important; }

        /* ============ THEME TOKENS ============ */
        .operator-dashboard {
          --op-bg: #0e0e10;
          --op-surface: #17171a;
          --op-surface-2: #1e1e23;
          --op-surface-3: #26262c;
          --op-border: #2a2a31;
          --op-text: #f4f4f6;
          --op-muted: #8a8a95;
          --op-accent: #ef3f25;
          --op-accent-soft: rgba(239,63,37,.14);
          --op-ok: #34d399;
          --op-warn: #f5a524;
          --op-info: #60a5fa;
          --op-nav-bg: rgba(14,14,16,.88);
          --op-overlay: rgba(0,0,0,.35);

          --op-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
          --op-ease-spring: cubic-bezier(0.32, 0.72, 0, 1);
          --op-ease-std: cubic-bezier(0.4, 0, 0.2, 1);
          --op-theme-dur: .35s;

          background: var(--op-bg);
          color: var(--op-text);
          min-height: 100vh;
          font-family: 'DM Sans', sans-serif;
          display: block;
          transition:
            background-color var(--op-theme-dur) var(--op-ease-std),
            color var(--op-theme-dur) var(--op-ease-std);
        }
        .operator-dashboard[data-op-theme="light"] {
          --op-bg: #f4f4f6;
          --op-surface: #ffffff;
          --op-surface-2: #fafafb;
          --op-surface-3: #f1f1f4;
          --op-border: #e6e6ea;
          --op-text: #16161a;
          --op-muted: #6b6b76;
          --op-nav-bg: rgba(244,244,246,.9);
          --op-overlay: rgba(16,16,20,.06);
        }

        /* ============ ENTRANCE ANIMATION ============ */
        @keyframes op-fade-up {
          from { opacity: 0; transform: translateY(14px) scale(.985); filter: blur(4px); }
          to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        @keyframes op-nav-in {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes op-detail-in {
          from { opacity: 0; transform: translateX(18px) scale(.99); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes op-draw {
          to { stroke-dashoffset: 0; }
        }

        .op-anim-in {
          animation: op-fade-up .55s var(--op-ease-out) both;
          will-change: transform, opacity, filter;
        }

        /* ============ STICKY NAV ============ */
        .op-nav {
          position: sticky;
          top: 0;
          z-index: 100;
          background: var(--op-nav-bg);
          backdrop-filter: blur(14px) saturate(1.5);
          -webkit-backdrop-filter: blur(14px) saturate(1.5);
          border-bottom: 1px solid var(--op-border);
          padding: 10px 16px;
          animation: op-nav-in .5s var(--op-ease-out) both;
          transition:
            background-color var(--op-theme-dur) var(--op-ease-std),
            border-color var(--op-theme-dur) var(--op-ease-std);
        }
        .op-nav__inner {
          max-width: 1440px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .op-brand {
          display: flex; align-items: center; gap: 10px;
          font-weight: 700; font-size: 14px; letter-spacing: -.01em;
          min-width: 0;
        }
        .op-brand__dot {
          width: 9px; height: 9px; border-radius: 50%;
          background: var(--op-accent);
          box-shadow: 0 0 0 4px var(--op-accent-soft);
          flex-shrink: 0;
          transition: box-shadow .3s var(--op-ease-std);
        }
        .op-brand__text {
          display: flex; flex-direction: column; min-width: 0;
          line-height: 1.1;
        }
        .op-brand small {
          font-weight: 500; font-size: 10.5px;
          color: var(--op-muted); letter-spacing: 0; margin-top: 2px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .op-nav__spacer { flex: 1; min-width: 8px; }
        .op-nav__status {
          display: flex; align-items: center; gap: 6px;
          flex-wrap: nowrap; overflow: hidden;
        }
        .op-nav__actions {
          display: flex; align-items: center; gap: 6px;
          flex-shrink: 0;
        }

        .op-pill {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 5px 11px; border-radius: 999px;
          background: var(--op-surface);
          border: 1px solid var(--op-border);
          font-size: 11.5px; font-weight: 600;
          white-space: nowrap;
          transition:
            background-color var(--op-theme-dur) var(--op-ease-std),
            border-color var(--op-theme-dur) var(--op-ease-std),
            color var(--op-theme-dur) var(--op-ease-std);
        }
        .op-pill i {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--op-ok); display: block;
          box-shadow: 0 0 0 3px rgba(52,211,153,.18);
        }
        .op-pill--alert i {
          background: var(--op-warn);
          box-shadow: 0 0 0 3px rgba(245,165,36,.18);
        }

        .op-icon-btn {
          width: 42px; height: 42px; border-radius: 12px;
          display: grid; place-items: center; cursor: pointer;
          background: var(--op-surface);
          border: 1px solid var(--op-border);
          color: var(--op-muted);
          flex-shrink: 0;
          transition:
            transform .28s var(--op-ease-spring),
            background-color var(--op-theme-dur) var(--op-ease-std),
            border-color var(--op-theme-dur) var(--op-ease-std),
            color var(--op-theme-dur) var(--op-ease-std);
        }
        .op-icon-btn:hover { color: var(--op-text); border-color: var(--op-accent); }
        .op-icon-btn:active { transform: scale(.9); transition-duration: .08s; }
        .op-icon-btn--accent { color: var(--op-accent); }
        .op-icon-btn--accent:hover { background: var(--op-accent-soft); }

        /* ============ CONTENT WRAP ============ */
        .op-wrap {
          max-width: 1440px;
          margin: 0 auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        /* ============ TOAST ============ */
        .op-toast {
          padding: 10px 14px; border-radius: 10px;
          background: var(--op-accent-soft);
          border: 1px solid rgba(239,63,37,.4);
          font-size: 13px; word-break: break-word;
          color: var(--op-text);
          white-space: pre-wrap;
          animation: op-fade-up .4s var(--op-ease-out) both;
        }

        /* ============ STAT CARDS ============ */
        .op-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }
        .op-stats > .op-card:nth-child(1) { animation-delay: .04s; }
        .op-stats > .op-card:nth-child(2) { animation-delay: .09s; }
        .op-stats > .op-card:nth-child(3) { animation-delay: .14s; }
        .op-stats > .op-card:nth-child(4) { animation-delay: .19s; }

        .op-card {
          background: var(--op-surface);
          border: 1px solid var(--op-border);
          border-radius: 16px;
          padding: 16px;
          box-shadow: 0 1px 2px var(--op-overlay);
          transition:
            background-color var(--op-theme-dur) var(--op-ease-std),
            border-color var(--op-theme-dur) var(--op-ease-std),
            box-shadow .4s var(--op-ease-out),
            transform .4s var(--op-ease-out);
        }

        .op-stat__label {
          font-size: 11px; color: var(--op-muted);
          font-weight: 600; letter-spacing: .06em;
          text-transform: uppercase;
          transition: color var(--op-theme-dur) var(--op-ease-std);
        }
        .op-stat__label-long { display: inline; }
        .op-stat__label-short { display: none; }

        .op-stat__row {
          display: flex; align-items: baseline; gap: 8px;
          margin-top: 8px;
          flex-wrap: wrap;
        }
        .op-stat__value {
          font-size: 24px; font-weight: 700;
          letter-spacing: -.02em; line-height: 1;
          transition: color var(--op-theme-dur) var(--op-ease-std);
        }
        .op-stat__delta {
          font-size: 11px; font-weight: 700;
          padding: 3px 7px; border-radius: 999px;
          transition:
            background-color var(--op-theme-dur) var(--op-ease-std),
            color var(--op-theme-dur) var(--op-ease-std);
        }
        .op-delta--up { color: var(--op-ok); background: rgba(52,211,153,.12); }
        .op-delta--down { color: var(--op-accent); background: var(--op-accent-soft); }
        .op-delta--flat { color: var(--op-info); background: rgba(96,165,250,.12); }

        .op-spark {
          margin-top: 10px; display: block;
          width: 100%; height: 28px;
          overflow: visible;
        }
        .op-spark polyline {
          fill: none; stroke: var(--op-accent);
          stroke-width: 2;
          stroke-linecap: round;
          stroke-linejoin: round;
          stroke-dasharray: 220;
          stroke-dashoffset: 220;
          animation: op-draw 1.1s var(--op-ease-out) forwards;
          animation-delay: inherit;
        }
        .op-spark--ok polyline { stroke: var(--op-ok); }
        .op-spark--info polyline { stroke: var(--op-info); }
        .op-spark--warn polyline { stroke: var(--op-warn); }

        /* ============ MAIN GRID ============ */
        .op-main-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.9fr) minmax(0, 1fr);
          gap: 14px;
          align-items: start;
        }
        .op-col {
          display: flex; flex-direction: column;
          gap: 14px; min-width: 0;
        }

        /* ============ CARD HEAD ============ */
        .op-card__head {
          display: flex; align-items: center; gap: 10px;
          margin-bottom: 14px; min-width: 0;
        }
        .op-card__head--stack {
          flex-direction: column;
          align-items: stretch;
        }
        .op-card__title {
          font-size: 14px; font-weight: 700;
          letter-spacing: -.01em;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .op-card__sub {
          font-size: 11.5px; color: var(--op-muted);
          margin-top: 2px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .op-card__spacer { flex: 1; min-width: 8px; }

        .op-back-btn {
          width: 34px; height: 34px; border-radius: 9px;
          display: grid; place-items: center;
          background: var(--op-surface-2);
          border: 1px solid var(--op-border);
          color: var(--op-text);
          cursor: pointer; flex-shrink: 0;
          transition:
            transform .28s var(--op-ease-spring),
            background-color var(--op-theme-dur) var(--op-ease-std),
            border-color var(--op-theme-dur) var(--op-ease-std),
            color var(--op-theme-dur) var(--op-ease-std);
        }
        .op-back-btn:hover { border-color: var(--op-accent); color: var(--op-accent); }
        .op-back-btn:active { transform: scale(.9); transition-duration: .08s; }

        /* ============ SEGMENTED CONTROL ============ */
        .op-seg {
          display: flex; gap: 2px;
          background: var(--op-surface-2);
          border: 1px solid var(--op-border);
          border-radius: 10px; padding: 3px;
          align-self: flex-start;
          transition:
            background-color var(--op-theme-dur) var(--op-ease-std),
            border-color var(--op-theme-dur) var(--op-ease-std);
        }
        .op-seg button {
          border: 0; background: none; cursor: pointer;
          color: var(--op-muted); font: inherit;
          font-size: 11.5px; font-weight: 600;
          padding: 6px 11px; border-radius: 7px;
          display: inline-flex; align-items: center; gap: 5px;
          white-space: nowrap;
          transition:
            background-color .3s var(--op-ease-std),
            color .3s var(--op-ease-std),
            transform .28s var(--op-ease-spring);
        }
        .op-seg button:active { transform: scale(.96); }
        .op-seg button.is-active { background: var(--op-accent); color: #fff; }
        .op-seg button.is-active--ok { background: var(--op-ok); color: #08261a; }
        .op-seg button.is-active--muted { background: var(--op-surface-3); color: var(--op-text); }
        .op-seg__dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
        .op-seg__dot--ok { background: var(--op-ok); }
        .op-seg__dot--off { background: #6b7280; }

        /* ============ DEVICE GRID ============ */
        .op-device-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
          gap: 10px;
        }
        .op-device-grid > .op-device:nth-child(1) { animation-delay: .05s; }
        .op-device-grid > .op-device:nth-child(2) { animation-delay: .09s; }
        .op-device-grid > .op-device:nth-child(3) { animation-delay: .13s; }
        .op-device-grid > .op-device:nth-child(4) { animation-delay: .17s; }
        .op-device-grid > .op-device:nth-child(5) { animation-delay: .21s; }
        .op-device-grid > .op-device:nth-child(6) { animation-delay: .25s; }
        .op-device-grid > .op-device:nth-child(n+7) { animation-delay: .28s; }

        .op-device {
          border: 1px solid var(--op-border);
          background: var(--op-surface-2);
          border-radius: 12px;
          padding: 12px;
          display: flex; flex-direction: column; gap: 6px;
          cursor: pointer;
          transition:
            transform .32s var(--op-ease-spring),
            border-color .3s var(--op-ease-std),
            background-color .3s var(--op-ease-std),
            box-shadow .3s var(--op-ease-out);
        }
        .op-device:hover {
          border-color: rgba(239,63,37,.5);
          background: var(--op-accent-soft);
          transform: translateY(-2px);
        }
        .op-device:active { transform: scale(.98); transition-duration: .1s; }
        .op-device.is-selected {
          border-color: var(--op-accent);
          background: var(--op-accent-soft);
          box-shadow: 0 0 0 1px rgba(239,63,37,.3);
        }
        .op-device.is-online { border-color: rgba(52,211,153,.35); }
        .op-device.is-online.is-selected { border-color: var(--op-accent); }

        .op-device__head { display: flex; align-items: center; gap: 8px; }
        .op-device__dot {
          width: 8px; height: 8px; border-radius: 50%;
          flex-shrink: 0;
        }
        .op-device__dot--on { background: var(--op-ok); box-shadow: 0 0 6px rgba(52,211,153,.8); }
        .op-device__dot--off { background: #6b7280; }
        .op-device__name {
          font-size: 12.5px; font-weight: 700; flex: 1;
          word-break: break-word; min-width: 0;
        }
        .op-device__icon { color: var(--op-muted); display: grid; place-items: center; flex-shrink: 0; }
        .op-device__meta { font-size: 10.5px; color: var(--op-muted); }
        .op-device__id { font-size: 10px; color: var(--op-muted); font-variant-numeric: tabular-nums; }
        .op-device__event { font-size: 11.5px; color: rgba(244,244,246,.7); }
        [data-op-theme="light"] .op-device__event { color: rgba(22,22,26,.75); }
        .op-device__row {
          display: flex; justify-content: space-between;
          font-size: 11px; gap: 8px;
        }
        .op-device__row span:first-child { color: var(--op-muted); }
        .op-device__row span:last-child { color: var(--op-text); text-align: right; word-break: break-word; }
        .op-device__phase {
          display: inline-block;
          font-size: 10px; font-weight: 700; letter-spacing: .06em;
          color: var(--op-accent); background: var(--op-accent-soft);
          padding: 2px 6px; border-radius: 6px;
        }
        .op-device__status {
          font-size: 10px; font-weight: 700; letter-spacing: .12em;
          color: var(--op-ok); margin-top: 2px;
        }
        .op-device__status--off { color: #6b7280; }
        .op-device__hint {
          margin-top: 4px; font-size: 10px;
          text-align: right; color: var(--op-muted);
        }

        /* ============ DETAIL VIEW (INLINE) ============ */
        .op-detail {
          display: flex; flex-direction: column; gap: 14px;
          animation: op-detail-in .5s var(--op-ease-out) both;
        }

        .op-badge {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 3px 9px; border-radius: 999px;
          font-size: 10.5px; font-weight: 700;
          white-space: nowrap;
          transition:
            background-color var(--op-theme-dur) var(--op-ease-std),
            color var(--op-theme-dur) var(--op-ease-std);
        }
        .op-badge::before {
          content: ""; width: 6px; height: 6px;
          border-radius: 50%; background: currentColor;
        }
        .op-badge--ok { color: var(--op-ok); background: rgba(52,211,153,.12); }
        .op-badge--warn { color: var(--op-warn); background: rgba(245,165,36,.13); }
        .op-badge--err { color: var(--op-accent); background: var(--op-accent-soft); }
        .op-badge--info { color: var(--op-info); background: rgba(96,165,250,.12); }
        .op-badge--muted { color: var(--op-muted); background: var(--op-surface-3); }
        .op-badge--plain::before { display: none; }

        .op-section-title {
          font-size: 11px; letter-spacing: .1em;
          color: var(--op-muted); font-weight: 700;
          text-transform: uppercase; margin: 0 0 10px;
        }

        .op-info-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 10px;
        }
        .op-info-card {
          border: 1px solid var(--op-border);
          background: var(--op-surface-2);
          border-radius: 10px;
          padding: 11px;
          min-width: 0;
          transition:
            background-color var(--op-theme-dur) var(--op-ease-std),
            border-color var(--op-theme-dur) var(--op-ease-std);
        }
        .op-info-card__label {
          display: flex; align-items: center; gap: 5px;
          font-size: 10px; color: var(--op-muted);
          letter-spacing: .06em; margin-bottom: 5px;
        }
        .op-info-card__value {
          font-size: 13.5px; font-weight: 700;
          word-break: break-word;
        }

        /* rename */
        .op-rename-box {
          padding: 12px;
          background: var(--op-surface-2);
          border: 1px solid var(--op-border);
          border-radius: 12px;
          transition:
            background-color var(--op-theme-dur) var(--op-ease-std),
            border-color var(--op-theme-dur) var(--op-ease-std);
        }
        .op-rename-box__head {
          display: flex; align-items: center; gap: 7px;
          font-size: 11px; font-weight: 700; letter-spacing: .1em;
          color: var(--op-accent); margin-bottom: 12px;
        }
        .op-label {
          font-size: 10px; color: var(--op-muted);
          letter-spacing: .06em; margin-bottom: 5px;
        }
        .op-rename-current {
          padding: 9px 12px;
          background: var(--op-surface);
          border: 1px solid var(--op-border);
          border-radius: 8px;
          font-size: 13px; font-weight: 700;
          word-break: break-all;
          margin-bottom: 12px;
          transition:
            background-color var(--op-theme-dur) var(--op-ease-std),
            border-color var(--op-theme-dur) var(--op-ease-std);
        }
        .op-rename-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .op-input {
          flex: 1; min-width: 160px;
          padding: 10px 12px;
          background: var(--op-surface);
          border: 1px solid var(--op-border);
          border-radius: 8px;
          color: var(--op-text);
          font-size: 13px; font-family: inherit;
          outline: none;
          transition:
            border-color .25s var(--op-ease-std),
            box-shadow .25s var(--op-ease-std),
            background-color var(--op-theme-dur) var(--op-ease-std);
        }
        .op-input:focus {
          border-color: var(--op-accent);
          box-shadow: 0 0 0 3px var(--op-accent-soft);
        }
        .op-input::placeholder { color: var(--op-muted); }

        .op-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 10px 16px; border: 0; border-radius: 8px;
          font-family: inherit; font-size: 12px; font-weight: 700;
          letter-spacing: .06em; cursor: pointer;
          white-space: nowrap;
          transition:
            transform .28s var(--op-ease-spring),
            background-color .25s var(--op-ease-std),
            color .25s var(--op-ease-std),
            border-color .25s var(--op-ease-std);
        }
        .op-btn:active:not(:disabled) { transform: scale(.96); }
        .op-btn--accent { background: var(--op-accent); color: #fff; }
        .op-btn--accent:hover:not(:disabled) { background: #d63320; }
        .op-btn--accent:disabled {
          background: var(--op-surface-3); color: var(--op-muted);
          cursor: not-allowed;
        }
        .op-btn--ghost {
          background: var(--op-surface-2);
          color: var(--op-text);
          border: 1px solid var(--op-border);
        }
        .op-btn--ghost:hover {
          background: var(--op-surface-3);
          border-color: var(--op-accent);
          color: var(--op-accent);
        }
        .op-btn--ghost:disabled {
          opacity: .45;
          cursor: not-allowed;
        }
        .op-btn--ok {
          background: rgba(52,211,153,.15);
          color: var(--op-ok);
          border: 1px solid rgba(52,211,153,.35);
        }
        .op-btn--ok:hover:not(:disabled) {
          background: rgba(52,211,153,.25);
        }
        .op-btn--danger {
          background: rgba(239,63,37,.1);
          color: var(--op-accent);
          border: 1px solid rgba(239,63,37,.3);
        }
        .op-btn--danger:hover:not(:disabled) {
          background: rgba(239,63,37,.2);
        }

        /* bar */
        .op-bar {
          height: 8px; border-radius: 999px;
          background: var(--op-surface-3);
          overflow: hidden;
          transition: background-color var(--op-theme-dur) var(--op-ease-std);
        }
        .op-bar__fill {
          height: 100%; border-radius: 999px;
          transition: width .55s var(--op-ease-out), background-color var(--op-theme-dur) var(--op-ease-std);
        }
        .op-bar__fill--ok { background: var(--op-ok); }
        .op-bar__fill--warn { background: var(--op-warn); }
        .op-bar__fill--err { background: var(--op-accent); }

        /* rows */
        .op-row {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 0;
          border-bottom: 1px solid var(--op-border);
          transition: border-color var(--op-theme-dur) var(--op-ease-std);
        }
        .op-row:last-child { border-bottom: 0; padding-bottom: 0; }
        .op-row:first-child { padding-top: 0; }
        .op-row__label {
          flex: 1; font-size: 12.5px; font-weight: 500;
          min-width: 0; overflow: hidden; text-overflow: ellipsis;
        }
        .op-row__meta { font-size: 11px; color: var(--op-muted); }
        .op-row__value {
          font-size: 12.5px; font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .op-row--stack {
          flex-direction: column;
          align-items: stretch;
          gap: 4px;
        }
        .op-row--stack .op-row__label { overflow: visible; white-space: normal; }

        /* quick actions */
        .op-qa-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px 6px;
        }
        .op-qa {
          display: flex; flex-direction: column; align-items: center;
          gap: 8px;
          background: none; border: 0; cursor: pointer;
          color: var(--op-text); font-family: inherit;
          font-size: 10.5px; font-weight: 600;
          text-align: center; line-height: 1.25;
          padding: 0;
        }
        .op-qa:disabled { cursor: not-allowed; opacity: .4; }
        .op-qa__btn {
          width: 52px; height: 52px; border-radius: 50%;
          display: grid; place-items: center;
          background: var(--op-surface-2);
          border: 1px solid var(--op-border);
          color: var(--op-text);
          transition:
            transform .32s var(--op-ease-spring),
            background-color .25s var(--op-ease-std),
            border-color .25s var(--op-ease-std),
            color .25s var(--op-ease-std),
            box-shadow .3s var(--op-ease-out);
        }
        .op-qa:hover:not(:disabled) .op-qa__btn {
          border-color: var(--op-accent);
          color: var(--op-accent);
          background: var(--op-accent-soft);
          transform: translateY(-3px);
          box-shadow: 0 8px 18px var(--op-accent-soft);
        }
        .op-qa:active:not(:disabled) .op-qa__btn {
          transform: scale(.92);
          transition-duration: .1s;
        }
        .op-qa--primary .op-qa__btn {
          background: var(--op-accent);
          border-color: var(--op-accent);
          color: #fff;
          box-shadow: 0 6px 18px var(--op-accent-soft);
        }
        .op-qa--primary:hover:not(:disabled) .op-qa__btn {
          filter: brightness(1.08); color: #fff;
          background: var(--op-accent);
        }
        .op-qa--danger .op-qa__btn { color: #ff8574; }
        .op-qa--info .op-qa__btn { color: var(--op-info); }

        .op-qa-hint {
          padding: 10px; margin-bottom: 12px;
          font-size: 11.5px; color: var(--op-muted);
          text-align: center;
          border: 1px dashed var(--op-border);
          border-radius: 10px;
          background: var(--op-surface-2);
          transition:
            background-color var(--op-theme-dur) var(--op-ease-std),
            border-color var(--op-theme-dur) var(--op-ease-std);
        }

        /* health grid */
        .op-health-block {
          padding: 10px 0;
          border-bottom: 1px solid var(--op-border);
        }
        .op-health-block:last-child { border-bottom: 0; padding-bottom: 0; }
        .op-health-block:first-child { padding-top: 0; }
        .op-health-head {
          display: flex; justify-content: space-between; align-items: center;
          font-size: 12px; margin-bottom: 8px; gap: 8px;
        }
        .op-health-head__left {
          display: inline-flex; align-items: center; gap: 5px;
          color: var(--op-text); font-weight: 600;
        }
        .op-health-head__right {
          font-weight: 700; font-variant-numeric: tabular-nums;
        }

        /* activity row */
        .op-activity-row {
          display: flex; gap: 8px;
          padding: 8px 0;
          border-bottom: 1px dashed var(--op-border);
          font-size: 12px;
          align-items: flex-start;
        }
        .op-activity-row:last-child { border-bottom: 0; padding-bottom: 0; }
        .op-activity-row:first-child { padding-top: 0; }
        .op-activity-row__time {
          font-size: 10.5px; color: var(--op-muted);
          font-variant-numeric: tabular-nums;
          flex-shrink: 0; min-width: 52px;
        }
        .op-activity-row__body {
          flex: 1; min-width: 0;
          word-break: break-word;
        }
        .op-activity-row__action {
          font-weight: 700; color: var(--op-text);
        }
        .op-activity-row__detail {
          font-size: 11px; color: var(--op-muted); margin-top: 2px;
        }

        /* alerts row */
        .op-alert-row {
          display: flex; gap: 8px;
          padding: 8px 0;
          border-bottom: 1px solid var(--op-border);
          align-items: flex-start;
          font-size: 12px;
        }
        .op-alert-row:last-child { border-bottom: 0; padding-bottom: 0; }
        .op-alert-row:first-child { padding-top: 0; }
        .op-alert-row__body {
          flex: 1; min-width: 0; word-break: break-word;
        }
        .op-alert-row__meta {
          font-size: 10.5px; color: var(--op-muted); margin-top: 2px;
        }

        /* empty */
        .op-empty {
          padding: 24px 8px; text-align: center;
          font-size: 13px; color: var(--op-muted);
          animation: op-fade-up .5s var(--op-ease-out) both;
        }

        /* ============ RESPONSIVE ============ */
        @media (max-width: 1080px) {
          .op-main-grid { grid-template-columns: minmax(0, 1fr); }
        }

        @media (max-width: 640px) {
          .op-nav { padding: 8px 12px; }
          .op-nav__status { display: none; }
          .op-brand small { display: none; }
          .op-brand { font-size: 13px; }
          .op-wrap { padding: 12px; gap: 12px; }
          .op-card { padding: 12px; border-radius: 14px; }
          .op-device-grid { grid-template-columns: minmax(0, 1fr); }
          .op-seg button { padding: 6px 9px; font-size: 11px; }
          .op-qa__btn { width: 48px; height: 48px; }
          .op-info-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }

          /* === STAT CARDS: 4 KOLOM DI MOBILE === */
          .op-stats {
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 6px;
          }
          .op-stats > .op-card {
            padding: 10px 8px;
            border-radius: 12px;
          }
          .op-stat__label {
            font-size: 8.5px;
            letter-spacing: .04em;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .op-stat__label-long { display: none; }
          .op-stat__label-short { display: inline; }
          .op-stat__row {
            margin-top: 6px;
            gap: 4px;
          }
          .op-stat__value { font-size: 17px; }
          .op-stat__delta {
            font-size: 8.5px;
            padding: 2px 5px;
            letter-spacing: 0;
          }
          .op-spark {
            margin-top: 6px;
            height: 16px;
          }
          .op-spark polyline { stroke-width: 2.4; }
        }

        @media (max-width: 380px) {
          .op-stat__value { font-size: 15px; }
          .op-stat__delta { display: none; }
          .op-stat__label { font-size: 8px; }
        }

        /* ============ REDUCED MOTION ============ */
        @media (prefers-reduced-motion: reduce) {
          .operator-dashboard *,
          .operator-dashboard *::before,
          .operator-dashboard *::after {
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
          }
          .op-spark polyline {
            stroke-dashoffset: 0 !important;
            animation: none !important;
          }
        }
      `}</style>

      <main className="operator-dashboard" data-op-theme={theme}>

        {/* ============ STICKY NAV ============ */}
        <nav className="op-nav">
          <div className="op-nav__inner">
            <div className="op-brand">
              <span className="op-brand__dot" />
              <div className="op-brand__text">
                <span>R3A Booth</span>
                <small>
                  Operator{eventSlug ? ` · ${eventSlug}` : ''}
                  {focusDeviceId ? ` · Focus` : ''}
                </small>
              </div>
            </div>

            <div className="op-nav__spacer" />

            <div className="op-nav__status">
              <span className="op-pill">
                <i />
                {onlineCount > 0 ? 'Online' : 'Idle'}
              </span>
              <span className="op-pill">
                {onlineCount} / {eventFiltered.length}
              </span>
              {aggregatedStats.totalAlerts > 0 ? (
                <span className="op-pill op-pill--alert" title="Total alerts">
                  <i /> {aggregatedStats.totalAlerts}
                </span>
              ) : null}
            </div>

            <div className="op-nav__actions">
              <button
                type="button"
                className="op-icon-btn"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                title={theme === 'dark' ? 'Mode terang' : 'Mode gelap'}
                aria-label="Ganti tema"
              >
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              </button>

              {onBackToPhotobooth && eventSlug ? (
                <button
                  type="button"
                  className="op-icon-btn op-icon-btn--accent"
                  onClick={onBackToPhotobooth}
                  title="Kembali ke Photobooth"
                  aria-label="Kembali ke Photobooth"
                >
                  <ChevronLeft size={18} />
                </button>
              ) : null}

              <button
                type="button"
                className="op-icon-btn"
                onClick={onClose}
                title="Tutup"
                aria-label="Tutup"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </nav>

        {/* ============ CONTENT ============ */}
        <div className="op-wrap">

          {actionMessage ? <div className="op-toast">{actionMessage}</div> : null}

          {/* STAT CARDS */}
          <section className="op-stats" style={{ gridTemplateColumns: isSecondaryAdmin ? 'repeat(3, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))' }}>
            <StatCard
              label="Sesi"
              shortLabel="SESI"
              value={String(displayStats.totalSessions)}
              numericValue={displayStats.totalSessions}
              delta={displayStats.totalSessions > 0 ? `+${displayStats.totalSessions}` : '±0'}
              deltaTone="up"
              subtitle={selectedDevice ? (selectedDevice.deviceName || 'Device') : 'Semua Device'}
            />
            <StatCard
              label="Foto"
              shortLabel="FOTO"
              value={String(displayStats.totalPhotos)}
              numericValue={displayStats.totalPhotos}
              delta={displayStats.totalPhotos > 0 ? `+${displayStats.totalPhotos}` : '±0'}
              deltaTone="up"
              subtitle={selectedDevice ? (selectedDevice.deviceName || 'Device') : 'Semua Device'}
            />
            {!isSecondaryAdmin && (
              <StatCard
                label="Pendapatan"
                shortLabel="OMZET"
                value={`Rp ${(displayStats.totalRevenue).toLocaleString('id-ID')}`}
                numericValue={displayStats.totalRevenue}
                delta="Est."
                deltaTone="flat"
                tone="info"
                subtitle={selectedDevice ? (selectedDevice.deviceName || 'Device') : 'Semua Device'}
              />
            )}
            <StatCard
              label="Failed"
              shortLabel="FAIL"
              value={String(displayStats.totalFailed)}
              numericValue={displayStats.totalFailed}
              delta={displayStats.totalFailed === 0 ? 'Clean' : 'Perlu cek'}
              deltaTone={displayStats.totalFailed === 0 ? 'up' : 'down'}
              tone={displayStats.totalFailed > 0 ? 'warn' : 'ok'}
              subtitle={selectedDevice ? (selectedDevice.deviceName || 'Device') : 'Semua Device'}
            />
          </section>

          {/* MAIN GRID */}
          <div className="op-main-grid">

            {/* LEFT COLUMN */}
            <div className="op-col">

              {/* LIVE DEVICES + INLINE DETAIL */}
              <div className="op-card">
                {selectedDevice ? (
                  <>
                    <div className="op-card__head">
                      <button
                        type="button"
                        className="op-back-btn"
                        onClick={() => setSelectedDeviceId(null)}
                        title="Kembali ke daftar"
                        aria-label="Kembali ke daftar device"
                      >
                        <ArrowLeft size={16} />
                      </button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="op-card__title">
                          {selectedDevice.deviceName
                            || `${selectedDevice.browser} · ${selectedDevice.os}`}
                        </div>
                        <div className="op-card__sub">
                          {selectedDevice.browser} · {formatDeviceType(selectedDevice.deviceType || 'unknown')} · {selectedDevice.os}
                        </div>
                      </div>
                      {selectedDevice.maintenanceMode ? (
                        <span className="op-badge op-badge--warn">
                          <Wrench size={11} /> MAINT
                        </span>
                      ) : null}
                      {selectedDevice.locked ? (
                        <span className="op-badge op-badge--err">
                          <Lock size={11} /> LOCKED
                        </span>
                      ) : null}
                      {isDeviceOnline(selectedDevice) ? (
                        <span className="op-badge op-badge--ok">Online</span>
                      ) : (
                        <span className="op-badge op-badge--muted op-badge--plain">Offline</span>
                      )}
                    </div>

                    <div className="op-detail">
                      {/* SECONDARY ADMIN LINK */}
                      {!isSecondaryAdmin && (
                        <div className="op-rename-box" style={{ background: 'rgba(96,165,250,.08)', borderColor: 'rgba(96,165,250,.3)' }}>
                          <div className="op-rename-box__head" style={{ color: 'var(--op-info)' }}>
                            <Link2 size={13} /> SECONDARY ADMIN LINK
                          </div>
                          <p style={{ margin: '0 0 10px', fontSize: 11.5, color: 'var(--op-muted)', lineHeight: 1.5 }}>
                            Salin link ini untuk buka dashboard operator khusus device ini di layar lain (HP/tablet/laptop).
                          </p>
                          <button
                            type="button"
                            className="op-btn op-btn--ghost"
                            style={{ width: '100%', justifyContent: 'center' }}
                            onClick={handleCopyAdminLink}
                          >
                            <Copy size={14} /> COPY LINK ADMIN
                          </button>
                        </div>
                      )}

                      {/* RENAME */}
                      <div className="op-rename-box">
                        <div className="op-rename-box__head">
                          <Edit3 size={13} /> GANTI NAMA
                        </div>
                        <div className="op-label">NAMA BARU</div>
                        <div className="op-rename-row">
                          <input
                            type="text"
                            className="op-input"
                            value={renameInput}
                            onChange={(e) => setRenameInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && renameInput.trim()) void handleRename();
                            }}
                            placeholder="Contoh: Booth Utama…"
                          />
                          <button
                            type="button"
                            className="op-btn op-btn--accent"
                            onClick={handleRename}
                            disabled={renaming || !renameInput.trim()}
                          >
                            {renaming ? 'MENGIRIM…' : 'RENAME'}
                          </button>
                        </div>
                        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--op-muted)', lineHeight: 1.5 }}>
                          💡 Diterapkan dalam ~5 detik setelah device online.
                        </p>
                      </div>

                      {/* IDENTITY */}
                      <div>
                        <h4 className="op-section-title">Identitas</h4>
                        <div className="op-info-grid">
                          <InfoCard icon={<Monitor size={12} />} label="TIPE" value={formatDeviceType(selectedDevice.deviceType || 'unknown')} />
                          <InfoCard icon={<Globe size={12} />} label="BROWSER" value={selectedDevice.browser || '—'} />
                          <InfoCard icon={<Monitor size={12} />} label="OS" value={selectedDevice.os || '—'} />
                          <InfoCard icon={<Monitor size={12} />} label="SCREEN" value={selectedDevice.screenSize || '—'} />
                          <InfoCard icon={<Activity size={12} />} label="APP VERSION" value={selectedDevice.appVersion || '—'} />
                        </div>
                      </div>

                      {/* BATTERY & STORAGE — device-specific */}
                      <div>
                        <h4 className="op-section-title">Battery & Storage Health</h4>
                        <div className="op-info-card">
                          {/* Battery */}
                          <div className="op-health-block">
                            <div className="op-health-head">
                              <span className="op-health-head__left">
                                {selectedDevice.batteryCharging ? <BatteryCharging size={13} /> : <Battery size={13} />}
                                Baterai
                              </span>
                              <span className="op-health-head__right">
                                {batteryPct}%{selectedDevice.batteryCharging ? ' ⚡' : ''}
                              </span>
                            </div>
                            <div className="op-bar">
                              <div
                                className={`op-bar__fill ${batteryPct < 20 ? 'op-bar__fill--err' : batteryPct < 50 ? 'op-bar__fill--warn' : 'op-bar__fill--ok'}`}
                                style={{ width: `${Math.min(100, batteryPct)}%` }}
                              />
                            </div>
                          </div>

                          {/* Storage */}
                          <div className="op-health-block">
                            <div className="op-health-head">
                              <span className="op-health-head__left">
                                <Database size={13} /> Storage Lokal
                              </span>
                              <span className="op-health-head__right">
                                {selectedDevice.storageQuota > 0
                                  ? `${formatBytes(selectedDevice.storageUsage ?? 0)} / ${formatBytes(selectedDevice.storageQuota)}`
                                  : '—'}
                              </span>
                            </div>
                            <div className="op-bar">
                              <div
                                className={`op-bar__fill ${storagePct > 90 ? 'op-bar__fill--err' : storagePct > 75 ? 'op-bar__fill--warn' : 'op-bar__fill--ok'}`}
                                style={{ width: `${Math.min(100, storagePct)}%` }}
                              />
                            </div>
                            {selectedDevice.storageQuota > 0 ? (
                              <p style={{ margin: '6px 0 0', fontSize: 10.5, color: 'var(--op-muted)' }}>
                                {storagePct.toFixed(1)}% terpakai
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {/* DRIVE STORAGE */}
                      {selectedDevice.driveConnected && selectedDevice.driveLimit > 0 ? (
                        <div>
                          <h4 className="op-section-title">Storage Drive</h4>
                          <div className="op-info-grid" style={{ marginBottom: 10 }}>
                            <InfoCard icon={<HardDrive size={12} />} label="FREE" value={formatBytes(Math.max(0, selectedDevice.driveLimit - selectedDevice.driveUsage))} color="var(--op-ok)" />
                            <InfoCard icon={<HardDrive size={12} />} label="USED" value={formatBytes(selectedDevice.driveUsage)} color="var(--op-warn)" />
                            <InfoCard icon={<HardDrive size={12} />} label="LIMIT" value={formatBytes(selectedDevice.driveLimit)} />
                          </div>
                          <div className="op-bar">
                            <div
                              className={`op-bar__fill ${(selectedDevice.driveUsage / selectedDevice.driveLimit) > 0.9 ? 'op-bar__fill--err' : (selectedDevice.driveUsage / selectedDevice.driveLimit) > 0.75 ? 'op-bar__fill--warn' : 'op-bar__fill--ok'}`}
                              style={{ width: `${Math.min(100, (selectedDevice.driveUsage / selectedDevice.driveLimit) * 100)}%` }}
                            />
                          </div>
                          <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--op-muted)' }}>
                            {((selectedDevice.driveUsage / selectedDevice.driveLimit) * 100).toFixed(1)}% terpakai
                          </p>
                        </div>
                      ) : null}

                      {/* DRIVE & UPLOAD */}
                      <div>
                        <h4 className="op-section-title">Drive & Upload</h4>
                        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                          <div className="op-info-card">
                            <div className="op-info-card__label"><HardDrive size={11} /> DRIVE</div>
                            <div className="op-row" style={{ paddingTop: 6, paddingBottom: 6 }}>
                              <span className="op-row__label">Status</span>
                              {selectedDevice.driveConnected
                                ? <span className="op-badge op-badge--ok">Connected</span>
                                : <span className="op-badge op-badge--err">Not connected</span>}
                            </div>
                            <div className="op-row" style={{ paddingTop: 6, paddingBottom: 6 }}>
                              <span className="op-row__label">Account</span>
                              <span className="op-row__value" style={{ fontSize: 11.5, fontWeight: 600 }}>
                                {selectedDevice.driveAccount || '—'}
                              </span>
                            </div>
                            <div className="op-row" style={{ paddingTop: 6, paddingBottom: 0 }}>
                              <span className="op-row__label">Token</span>
                              <span className="op-row__value" style={{ fontSize: 11.5, color: selectedDevice.driveTokenExpiresAt > Date.now() ? 'var(--op-ok)' : 'var(--op-accent)' }}>
                                {formatTokenExpiry(selectedDevice.driveTokenExpiresAt ?? 0)}
                              </span>
                            </div>
                          </div>

                          <div className="op-info-card">
                            <div className="op-info-card__label"><CheckCircle2 size={11} /> UPLOAD</div>
                            <div className="op-row" style={{ paddingTop: 6, paddingBottom: 6 }}>
                              <span className="op-row__label">Uploaded</span>
                              <span className="op-row__value" style={{ color: 'var(--op-ok)' }}>{selectedDevice.uploadedCount ?? 0}</span>
                            </div>
                            <div className="op-row" style={{ paddingTop: 6, paddingBottom: 6 }}>
                              <span className="op-row__label">Pending</span>
                              <span className="op-row__value" style={{ color: 'var(--op-warn)' }}>{selectedDevice.pendingCount ?? 0}</span>
                            </div>
                            <div className="op-row" style={{ paddingTop: 6, paddingBottom: 0 }}>
                              <span className="op-row__label">Failed</span>
                              <span className="op-row__value" style={{ color: 'var(--op-accent)' }}>{selectedDevice.failedCount ?? 0}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* EVENT DURATION */}
                      {selectedDevice.eventOpenedAt > 0 ? (
                        <div>
                          <h4 className="op-section-title">Durasi Event</h4>
                          <div className="op-info-card">
                            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--op-accent)', letterSpacing: '-.02em' }}>
                              {formatDuration(Date.now() - selectedDevice.eventOpenedAt)}
                            </div>
                            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--op-muted)' }}>
                              Dibuka: {new Date(selectedDevice.eventOpenedAt).toLocaleTimeString()}
                            </p>
                          </div>
                        </div>
                      ) : null}

                      {/* QR HISTORY */}
                      <div>
                        <h4 className="op-section-title">
                          <QrCode size={12} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
                          Link Publik Terakhir
                        </h4>
                        
                        {latestQr ? (
                          <div style={{ marginBottom: 16 }}>
                            <a 
                              href={latestQr.url} 
                              target="_blank" 
                              rel="noreferrer"
                              className="op-info-card" 
                              style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center', 
                                border: '2px solid var(--op-accent)', 
                                background: 'var(--op-accent-soft)', 
                                padding: 16, 
                                textDecoration: 'none',
                                cursor: 'pointer',
                                transition: 'transform 0.2s',
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                            >
                              <div>
                                <div style={{ fontWeight: 800, fontSize: 15, color: '#fff' }}>
                                  {latestQr.type === 'drive-qr' ? 'Google Drive (Foto Terakhir)' : 'Result Page (Foto Terakhir)'}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--op-muted)', marginTop: 4 }}>
                                  Diambil pada: {new Date(latestQr.time).toLocaleTimeString()}
                                </div>
                              </div>
                              <div className="op-btn op-btn--accent" style={{ padding: '8px 16px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <ExternalLink size={16} /> BUKA LINK
                              </div>
                            </a>
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: 'var(--op-muted)', textAlign: 'center', padding: '10px 0' }}>
                            Belum ada link publik yang di-generate.
                          </div>
                        )}

                        {previousQrs.length > 0 && (
                          <>
                            <h4 className="op-section-title" style={{ marginTop: 20 }}>Riwayat Sebelumnya</h4>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {previousQrs.map((qr, idx) => (
                                <div key={idx} className="op-info-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10 }}>
                                  <div>
                                    <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 2 }}>
                                      {qr.type === 'drive-qr' ? 'Drive QR' : 'Result QR'}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--op-muted)' }}>
                                      {new Date(qr.time).toLocaleTimeString()} • {qr.id.slice(0, 6)}...
                                    </div>
                                  </div>
                                  <a 
                                    href={qr.url} 
                                    target="_blank" 
                                    rel="noreferrer"
                                    className="op-btn op-btn--ghost"
                                    style={{ padding: '6px 10px', fontSize: 11, textDecoration: 'none' }}
                                  >
                                    Buka <ExternalLink size={12} />
                                  </a>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>

                      {/* DELETE DEVICE */}
                      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--op-border)' }}>
                        <button
                          type="button"
                          className="op-btn"
                          style={{
                            width: '100%',
                            background: 'rgba(239,63,37,.1)',
                            color: 'var(--op-accent)',
                            border: '1px solid rgba(239,63,37,.3)',
                            justifyContent: 'center'
                          }}
                          onClick={() => handleDeleteDevice(selectedDevice.deviceId)}
                        >
                          <ShieldAlert size={16} /> Hapus Device dari Daftar
                        </button>
                        <p style={{ margin: '8px 0 0', fontSize: 10, color: 'var(--op-muted)', textAlign: 'center' }}>
                          *Device akan muncul kembali secara otomatis jika masih terhubung ke internet.
                        </p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="op-card__head op-card__head--stack">
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="op-card__title">
                            Live Devices <span style={{ color: 'var(--op-muted)', fontWeight: 500 }}>({filteredTablets.length})</span>
                          </div>
                          <div className="op-card__sub">Tap device untuk detail</div>
                        </div>
                      </div>
                      <div className="op-seg">
                        <button
                          type="button"
                          className={deviceFilter === 'all' ? 'is-active' : ''}
                          onClick={() => setDeviceFilter('all')}
                        >
                          ALL ({eventFiltered.length})
                        </button>
                        <button
                          type="button"
                          className={deviceFilter === 'online' ? 'is-active is-active--ok' : ''}
                          onClick={() => setDeviceFilter('online')}
                        >
                          <span className="op-seg__dot op-seg__dot--ok" />
                          ONLINE ({onlineCount})
                        </button>
                        <button
                          type="button"
                          className={deviceFilter === 'offline' ? 'is-active is-active--muted' : ''}
                          onClick={() => setDeviceFilter('offline')}
                        >
                          <span className="op-seg__dot op-seg__dot--off" />
                          OFFLINE ({offlineCount})
                        </button>
                      </div>
                    </div>

                    {filteredTablets.length === 0 ? (
                      <div className="op-empty">
                        {deviceFilter === 'online'
                          ? '✅ Tidak ada device online saat ini'
                          : deviceFilter === 'offline'
                            ? '✅ Semua device online'
                            : eventSlug
                              ? `Tidak ada device untuk event "${eventSlug}"`
                              : 'Tidak ada device terdeteksi'}
                      </div>
                    ) : (
                      <div className="op-device-grid" key={deviceFilter}>
                        {filteredTablets.map((t) => {
                          const lastActivityAgo = Math.floor((Date.now() - t.lastActivity) / 1000);
                          const isStale = lastActivityAgo > 60;
                          const isOnline = t.online && !isStale;
                          const openDuration = t.eventOpenedAt > 0 ? Date.now() - t.eventOpenedAt : 0;
                          const hasCustomName = !!(t.deviceName && t.deviceName.trim());
                          const hasAlerts = (t.alerts ?? []).length > 0;

                          return (
                            <div
                              key={t.deviceId}
                              onClick={() => setSelectedDeviceId(t.deviceId)}
                              className={`op-device op-anim-in ${isOnline ? 'is-online' : ''}`}
                            >
                              <div className="op-device__head">
                                <span className={`op-device__dot ${isOnline ? 'op-device__dot--on' : 'op-device__dot--off'}`} />
                                <strong className="op-device__name">
                                  {hasCustomName
                                    ? t.deviceName
                                    : `${t.browser || 'Browser'} - ${t.os || 'OS'}`}
                                </strong>
                                <span className="op-device__icon">{deviceTypeIcon(t.deviceType || 'desktop', 15)}</span>
                              </div>

                              {hasCustomName ? (
                                <div className="op-device__meta">
                                  {t.browser || 'Browser'} · {formatDeviceType(t.deviceType || 'unknown')} · {t.os || 'OS'}
                                </div>
                              ) : null}

                              <div className="op-device__id">ID: {t.deviceId.slice(-8)}</div>

                              {t.maintenanceMode || t.locked || hasAlerts ? (
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                  {t.maintenanceMode ? (
                                    <span className="op-badge op-badge--warn op-badge--plain" style={{ fontSize: 9 }}>
                                      <Wrench size={9} /> MAINT
                                    </span>
                                  ) : null}
                                  {t.locked ? (
                                    <span className="op-badge op-badge--err op-badge--plain" style={{ fontSize: 9 }}>
                                      <Lock size={9} /> LOCK
                                    </span>
                                  ) : null}
                                  {hasAlerts ? (
                                    <span className="op-badge op-badge--info op-badge--plain" style={{ fontSize: 9 }}>
                                      <Bell size={9} /> {(t.alerts ?? []).length}
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}

                              {t.currentEventName ? (
                                <div className="op-device__event">📸 {t.currentEventName}</div>
                              ) : (
                                <div className="op-device__event" style={{ color: 'var(--op-muted)' }}>Belum ada event</div>
                              )}

                              <div className="op-device__row">
                                <span>Phase</span>
                                <span className="op-device__phase">{t.currentPhase.toUpperCase()}</span>
                              </div>

                              <div className="op-device__row">
                                <span>Foto</span>
                                <span>{t.photoCount} / {t.totalCaptures}</span>
                              </div>

                              {openDuration > 0 ? (
                                <div className="op-device__row">
                                  <span>Buka event</span>
                                  <span>{formatDuration(openDuration)}</span>
                                </div>
                              ) : null}

                              <div className={`op-device__status ${isOnline ? '' : 'op-device__status--off'}`}>
                                ● {isOnline ? 'ONLINE' : 'OFFLINE'}
                              </div>

                              <div className="op-device__hint">Tap untuk detail →</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div className="op-col">

              {/* QUICK ACTIONS */}
              <div className="op-card">
                <div className="op-card__head">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="op-card__title">
                      <Zap size={13} style={{ verticalAlign: 'middle', marginRight: 5, color: 'var(--op-accent)' }} />
                      Quick Actions
                    </div>
                    <div className="op-card__sub">
                      {selectedDevice
                        ? <>→ {selectedDevice.browser} · {selectedDevice.os}</>
                        : 'Pilih device dulu'}
                    </div>
                  </div>
                </div>

                {!selectedDevice ? (
                  <div className="op-qa-hint">
                    Tap salah satu device di kiri untuk aktifkan aksi.
                  </div>
                ) : null}

                <div className="op-qa-grid">
                  <QaButton
                    icon={<Maximize2 size={20} />}
                    label="Fullscreen"
                    disabled={!selectedDevice}
                    onClick={() => handleCommand('force-fullscreen', 'Force Fullscreen')}
                  />
                  <QaButton
                    icon={<Key size={20} />}
                    label="Refresh Token"
                    disabled={!selectedDevice}
                    onClick={() => handleCommand('refresh-token', 'Refresh Token')}
                    tone="info"
                  />
                  <QaButton
                    icon={<Plug size={20} />}
                    label="Reconnect"
                    disabled={!selectedDevice}
                    onClick={() => handleCommand('reconnect-drive', 'Reconnect Drive')}
                    tone="info"
                  />
                  <QaButton
                    icon={<RefreshCw size={20} />}
                    label="Retry Upload"
                    disabled={!selectedDevice}
                    onClick={() => handleCommand('retry-all', 'Retry Upload')}
                    tone="primary"
                  />
                  <QaButton
                    icon={<Trash2 size={20} />}
                    label="Clear Cache"
                    disabled={!selectedDevice}
                    onClick={() => handleCommand('clear-cache', 'Clear Cache')}
                  />
                  <QaButton
                    icon={<RotateCcw size={20} />}
                    label="Reset Uptime"
                    disabled={!selectedDevice}
                    onClick={() => handleCommand('reset-uptime', 'Reset Uptime')}
                  />
                  <QaButton
                    icon={<Trash2 size={20} />}
                    label="Clear Stats"
                    disabled={!selectedDevice}
                    onClick={() => handleCommand('clear-stats', 'Clear Stats')}
                  />
                  <QaButton
                    icon={<Download size={20} />}
                    label="Logs"
                    disabled={!selectedDevice}
                    onClick={() => handleCommand('download-logs', 'Download Logs')}
                  />
                  <QaButton
                    icon={<Play size={20} />}
                    label="Reload App"
                    disabled={!selectedDevice}
                    onClick={() => handleCommand('reload-app', 'Reload App')}
                    tone="danger"
                  />
                </div>
              </div>

              {/* MAINTENANCE & LOCK — Phase 1 */}
              <div className="op-card">
                <div className="op-card__head">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="op-card__title">
                      <Wrench size={13} style={{ verticalAlign: 'middle', marginRight: 5, color: 'var(--op-warn)' }} />
                      Maintenance & Lock
                    </div>
                    <div className="op-card__sub">
                      {selectedDevice ? '→ Kontrol device terpilih' : 'Pilih device dulu'}
                    </div>
                  </div>
                </div>

                <div className="op-row">
                  <span className="op-row__label">
                    <Wrench size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                    Maintenance Mode
                  </span>
                  {selectedDevice?.maintenanceMode ? (
                    <button
                      type="button"
                      className="op-btn op-btn--danger"
                      style={{ padding: '6px 12px', fontSize: 11 }}
                      onClick={() => handleCommand('maintenance-off', 'Matikan Maintenance')}
                      disabled={!selectedDevice}
                    >
                      MATIKAN
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="op-btn op-btn--ghost"
                      style={{ padding: '6px 12px', fontSize: 11 }}
                      onClick={() => handleCommand('maintenance-on', 'Aktifkan Maintenance')}
                      disabled={!selectedDevice}
                    >
                      AKTIFKAN
                    </button>
                  )}
                </div>

                <div className="op-row">
                  <span className="op-row__label">
                    <Lock size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                    Lock Screen
                  </span>
                  {selectedDevice?.locked ? (
                    <button
                      type="button"
                      className="op-btn op-btn--ok"
                      style={{ padding: '6px 12px', fontSize: 11 }}
                      onClick={() => handleCommand('unlock-screen', 'Unlock Screen')}
                      disabled={!selectedDevice}
                    >
                      <Unlock size={12} /> UNLOCK
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="op-btn op-btn--ghost"
                      style={{ padding: '6px 12px', fontSize: 11 }}
                      onClick={() => handleCommand('lock-screen', 'Lock Screen')}
                      disabled={!selectedDevice}
                    >
                      <Lock size={12} /> LOCK
                    </button>
                  )}
                </div>

                <div className="op-row">
                  <span className="op-row__label">
                    <RotateCcw size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                    Force Reset
                  </span>
                  <button
                    type="button"
                    className="op-btn op-btn--danger"
                    style={{ padding: '6px 12px', fontSize: 11 }}
                    onClick={() => {
                      if (window.confirm('Force reset akan reset session di device (kembali ke frame-select). Lanjutkan?')) {
                        void handleCommand('force-reset', 'Force Reset');
                      }
                    }}
                    disabled={!selectedDevice}
                  >
                    RESET SESSION
                  </button>
                </div>
              </div>

              {/* HARDWARE STATUS + TEST PRINT */}
              <div className="op-card">
                <div className="op-card__head">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="op-card__title">Status Hardware</div>
                    <div className="op-card__sub">Pemantauan dari device terpilih</div>
                  </div>
                </div>
                <div className="op-row">
                  <span className="op-row__label">Printer</span>
                  <span className="op-badge op-badge--ok">Connected</span>
                </div>
                <div className="op-row">
                  <span className="op-row__label">Kamera</span>
                  <span className="op-badge op-badge--ok">Detected</span>
                </div>
                <div className="op-row">
                  <span className="op-row__label">
                    <Printer size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                    Test Print
                  </span>
                  <button
                    type="button"
                    className="op-btn op-btn--ghost"
                    style={{ padding: '6px 12px', fontSize: 11 }}
                    onClick={() => handleCommand('test-print', 'Test Print')}
                    disabled={!selectedDevice}
                  >
                    CETAK TEST
                  </button>
                </div>
              </div>

              {/* SMART ALERTS — Phase 3 */}
              <div className="op-card">
                <div className="op-card__head">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="op-card__title">
                      <Bell size={13} style={{ verticalAlign: 'middle', marginRight: 5, color: 'var(--op-warn)' }} />
                      Smart Alerts
                      {deviceAlerts.length > 0 ? (
                        <span style={{ color: 'var(--op-muted)', fontWeight: 500, marginLeft: 4 }}>
                          ({deviceAlerts.length})
                        </span>
                      ) : null}
                    </div>
                    <div className="op-card__sub">
                      {selectedDevice ? 'Dari device terpilih' : 'Pilih device dulu'}
                    </div>
                  </div>
                </div>

                {!selectedDevice ? (
                  <div className="op-qa-hint">Pilih device untuk lihat alerts.</div>
                ) : deviceAlerts.length === 0 ? (
                  <div className="op-qa-hint" style={{ color: 'var(--op-ok)' }}>
                    ✅ Tidak ada alert aktif
                  </div>
                ) : (
                  deviceAlerts.slice(0, 6).map((alert) => (
                    <div key={alert.id} className="op-alert-row">
                      <span className={`op-badge op-badge--${alert.level === 'error' ? 'err' : alert.level === 'warn' ? 'warn' : 'info'}`}>
                        {alert.level.toUpperCase()}
                      </span>
                      <div className="op-alert-row__body">
                        <div>{alert.message}</div>
                        <div className="op-alert-row__meta">{timeAgo(alert.time)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* LIVE ACTIVITY FEED — Phase 3 */}
              <div className="op-card">
                <div className="op-card__head">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="op-card__title">
                      <Activity size={13} style={{ verticalAlign: 'middle', marginRight: 5, color: 'var(--op-info)' }} />
                      Live Activity Feed
                    </div>
                    <div className="op-card__sub">
                      {selectedDevice ? 'Aktivitas device terpilih' : 'Pilih device dulu'}
                    </div>
                  </div>
                </div>

                {!selectedDevice ? (
                  <div className="op-qa-hint">Pilih device untuk lihat aktivitas.</div>
                ) : deviceActivity.length === 0 ? (
                  <div className="op-qa-hint">Belum ada aktivitas.</div>
                ) : (
                  deviceActivity.slice(0, 10).map((act) => (
                    <div key={act.id} className="op-activity-row">
                      <span className="op-activity-row__time">
                        {new Date(act.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                      <div className="op-activity-row__body">
                        <div className="op-activity-row__action">{act.action}</div>
                        {act.detail ? (
                          <div className="op-activity-row__detail">{act.detail}</div>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* HEALTH SUMMARY (AGREGAT) */}
              {!isSecondaryAdmin && (
                <div className="op-card">
                  <div className="op-card__head">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="op-card__title">Ringkasan Health</div>
                      <div className="op-card__sub">{eventFiltered.length} device terdeteksi</div>
                    </div>
                  </div>

                  <div className="op-row">
                    <span className="op-row__label">Online</span>
                    <span className="op-badge op-badge--ok">{onlineCount}</span>
                  </div>
                  <div className="op-row">
                    <span className="op-row__label">Offline</span>
                    <span className="op-badge op-badge--muted">{offlineCount}</span>
                  </div>
                  <div className="op-row">
                    <span className="op-row__label">Drive Connected</span>
                    <span className="op-badge op-badge--info">{aggregatedStats.driveConnectedCount}</span>
                  </div>
                  <div className="op-row">
                    <span className="op-row__label">Pending Upload</span>
                    <span className={`op-badge ${aggregatedStats.totalPending > 0 ? 'op-badge--warn' : 'op-badge--ok'}`}>
                      {aggregatedStats.totalPending}
                    </span>
                  </div>
                  <div className="op-row">
                    <span className="op-row__label">Failed Upload</span>
                    <span className={`op-badge ${aggregatedStats.totalFailed > 0 ? 'op-badge--err' : 'op-badge--ok'}`}>
                      {aggregatedStats.totalFailed}
                    </span>
                  </div>
                  <div className="op-row">
                    <span className="op-row__label">Active Alerts</span>
                    <span className={`op-badge ${aggregatedStats.totalAlerts > 0 ? 'op-badge--warn' : 'op-badge--ok'}`}>
                      {aggregatedStats.totalAlerts}
                    </span>
                  </div>
                </div>
              )}

              {/* STORAGE SUMMARY (AGREGAT) */}
              <div className="op-card">
                <div className="op-card__head">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="op-card__title">Storage Drive</div>
                    <div className="op-card__sub">Total dari device yang connected</div>
                  </div>
                  <span className="op-row__meta">
                    {aggregatedStats.driveLimit > 0
                      ? `${formatBytes(aggregatedStats.driveUsed)} / ${formatBytes(aggregatedStats.driveLimit)}`
                      : '—'}
                  </span>
                </div>

                <div className="op-bar">
                  <div
                    className={`op-bar__fill ${drivePercent > 90 ? 'op-bar__fill--err' : drivePercent > 75 ? 'op-bar__fill--warn' : 'op-bar__fill--ok'}`}
                    style={{ width: `${Math.min(100, drivePercent)}%` }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11.5, color: 'var(--op-muted)' }}>
                  <span>{drivePercent.toFixed(1)}% terpakai</span>
                  <span>
                    {aggregatedStats.driveLimit > 0
                      ? `${formatBytes(Math.max(0, aggregatedStats.driveLimit - aggregatedStats.driveUsed))} tersisa`
                      : 'Belum terhubung'}
                  </span>
                </div>
              </div>

              {/* EXPORT CSV */}
              {!isSecondaryAdmin && (
                <div className="op-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="op-card__head" style={{ marginBottom: 0 }}>
                    <div style={{ flex: 1 }}>
                      <div className="op-card__title">Export Laporan</div>
                      <div className="op-card__sub">Unduh data statistik ke CSV</div>
                    </div>
                  </div>
                  <button className="op-btn op-btn--accent" onClick={handleExportCSV} style={{ width: '100%', justifyContent: 'center' }}>
                    <FileSpreadsheet size={16} /> DOWNLOAD DATA
                  </button>
                </div>
              )}

            </div>
          </div>
        </div>
      </main>
    </>
  );
};

/* ---------- SUB COMPONENTS ---------- */

const InfoCard = ({
  icon, label, value, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color?: string;
}) => (
  <div className="op-info-card">
    <div className="op-info-card__label">
      {icon}
      <span>{label}</span>
    </div>
    <div className="op-info-card__value" style={{ color: color || 'var(--op-text)' }}>
      {value}
    </div>
  </div>
);

const StatCard = ({
  label, shortLabel, value, numericValue, delta, deltaTone, tone, subtitle
}: {
  label: string;
  shortLabel: string;
  value: string;
  numericValue: number;
  delta: string;
  deltaTone: 'up' | 'down' | 'flat';
  tone?: 'ok' | 'warn' | 'info' | 'default';
  subtitle?: string;
}) => {
  const toneClass = tone ? `op-spark--${tone}` : '';
  const sparkPoints = useMemo(() => getGraphData(numericValue), [numericValue]);

  return (
    <div className="op-card op-anim-in">
      <div className="op-stat__label">
        <span className="op-stat__label-long">{label}</span>
        <span className="op-stat__label-short">{shortLabel}</span>
        {subtitle && (
          <div style={{ fontSize: 9, color: 'var(--op-muted)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subtitle}
          </div>
        )}
      </div>
      <div className="op-stat__row">
        <span className="op-stat__value">{value}</span>
        <span className={`op-stat__delta op-delta--${deltaTone}`}>{delta}</span>
      </div>
      <svg className={`op-spark ${toneClass}`} viewBox="0 0 100 28" preserveAspectRatio="none">
        <polyline points={sparkPoints} />
      </svg>
    </div>
  );
};

const QaButton = ({
  icon, label, onClick, disabled, tone,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'danger' | 'info';
}) => {
  const toneClass = tone ? `op-qa--${tone}` : '';
  return (
    <button
      type="button"
      className={`op-qa ${toneClass}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
    >
      <span className="op-qa__btn">{icon}</span>
      <span>{label}</span>
    </button>
  );
};