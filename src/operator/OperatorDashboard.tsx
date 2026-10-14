import { useEffect, useState, useCallback, useMemo } from 'react';
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
} from 'lucide-react';
import type { AllSettings } from '../settingsStore';
import {
  subscribeAllTablets,
  sendCommand,
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

const THEME_KEY = 'r3a-op-theme';

/* ---------- COMPONENT ---------- */
export const OperatorDashboard = ({
  allSettings,
  eventSlug,
  onClose,
  onBackToPhotobooth,
}: {
  allSettings: AllSettings;
  eventSlug?: string;
  onClose: () => void;
  onBackToPhotobooth?: () => void;
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

  useEffect(() => {
    const unsubscribe = subscribeAllTablets((newTablets) => {
      setTablets(newTablets);
    });
    return unsubscribe;
  }, []);

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
    for (const t of eventFiltered) {
      totalSessions += t.todaySessionCount ?? 0;
      totalPhotos += t.todayPhotoCount ?? 0;
      totalUploaded += t.uploadedCount ?? 0;
      totalPending += t.pendingCount ?? 0;
      totalFailed += t.failedCount ?? 0;
      if (t.driveConnected && t.driveLimit > 0) {
        driveConnectedCount++;
        driveUsed += t.driveUsage ?? 0;
        driveLimit += t.driveLimit ?? 0;
      }
    }
    return {
      totalSessions, totalPhotos, totalUploaded, totalPending, totalFailed,
      driveUsed, driveLimit, driveConnectedCount,
    };
  }, [eventFiltered]);

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

  const drivePercent = aggregatedStats.driveLimit > 0
    ? (aggregatedStats.driveUsed / aggregatedStats.driveLimit) * 100
    : 0;

  const isDetailOpen = !!selectedDevice;

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

          background: var(--op-bg);
          color: var(--op-text);
          min-height: 100vh;
          font-family: 'DM Sans', sans-serif;
          display: block;
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

        /* ============ STICKY NAV ============ */
        .op-nav {
          position: sticky;
          top: 0;
          z-index: 100;
          background: var(--op-nav-bg);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border-bottom: 1px solid var(--op-border);
          padding: 10px 16px;
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
          flex-wrap: nowrap;
          overflow: hidden;
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
        }
        .op-pill i {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--op-ok); display: block;
          box-shadow: 0 0 0 3px rgba(52,211,153,.18);
        }

        .op-icon-btn {
          width: 42px; height: 42px; border-radius: 12px;
          display: grid; place-items: center; cursor: pointer;
          background: var(--op-surface);
          border: 1px solid var(--op-border);
          color: var(--op-muted);
          transition: .18s;
          flex-shrink: 0;
        }
        .op-icon-btn:hover { color: var(--op-text); border-color: var(--op-accent); }
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
        }

        /* ============ STAT CARDS ============ */
        .op-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }

        .op-card {
          background: var(--op-surface);
          border: 1px solid var(--op-border);
          border-radius: 16px;
          padding: 16px;
          box-shadow: 0 1px 2px var(--op-overlay);
        }

        .op-stat__label {
          font-size: 11px; color: var(--op-muted);
          font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
        }
        .op-stat__row {
          display: flex; align-items: baseline; gap: 8px; margin-top: 8px;
          flex-wrap: wrap;
        }
        .op-stat__value {
          font-size: 24px; font-weight: 700;
          letter-spacing: -.02em; line-height: 1;
        }
        .op-stat__delta {
          font-size: 11px; font-weight: 700;
          padding: 3px 7px; border-radius: 999px;
        }
        .op-delta--up { color: var(--op-ok); background: rgba(52,211,153,.12); }
        .op-delta--down { color: var(--op-accent); background: var(--op-accent-soft); }
        .op-delta--flat { color: var(--op-info); background: rgba(96,165,250,.12); }
        .op-spark {
          margin-top: 10px; display: block; width: 100%; height: 28px;
          overflow: visible;
        }
        .op-spark polyline {
          fill: none; stroke: var(--op-accent);
          stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
        }
        .op-spark--ok polyline { stroke: var(--op-ok); }
        .op-spark--info polyline { stroke: var(--op-info); }
        .op-spark--warn polyline { stroke: var(--op-warn); }

        /* ============ MAIN GRID ============ */
        .op-main-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.9fr) minmax(0, 1fr);
          gap: 14px; align-items: start;
        }
        .op-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

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
          font-size: 14px; font-weight: 700; letter-spacing: -.01em;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .op-card__sub {
          font-size: 11.5px; color: var(--op-muted); margin-top: 2px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .op-card__spacer { flex: 1; min-width: 8px; }

        .op-back-btn {
          width: 34px; height: 34px; border-radius: 9px;
          display: grid; place-items: center;
          background: var(--op-surface-2);
          border: 1px solid var(--op-border);
          color: var(--op-text);
          cursor: pointer;
          flex-shrink: 0;
          transition: .15s;
        }
        .op-back-btn:hover { border-color: var(--op-accent); color: var(--op-accent); }

        /* ============ SEGMENTED CONTROL ============ */
        .op-seg {
          display: flex; gap: 2px;
          background: var(--op-surface-2);
          border: 1px solid var(--op-border);
          border-radius: 10px; padding: 3px;
          align-self: flex-start;
        }
        .op-seg button {
          border: 0; background: none; cursor: pointer;
          color: var(--op-muted); font: inherit;
          font-size: 11.5px; font-weight: 600;
          padding: 6px 11px; border-radius: 7px;
          transition: .15s;
          display: inline-flex; align-items: center; gap: 5px;
          white-space: nowrap;
        }
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
        .op-device {
          border: 1px solid var(--op-border);
          background: var(--op-surface-2);
          border-radius: 12px;
          padding: 12px;
          display: flex; flex-direction: column; gap: 6px;
          cursor: pointer;
          transition: .18s;
        }
        .op-device:hover { border-color: rgba(239,63,37,.5); background: var(--op-accent-soft); }
        .op-device.is-selected {
          border-color: var(--op-accent);
          background: var(--op-accent-soft);
          box-shadow: 0 0 0 1px rgba(239,63,37,.3);
        }
        .op-device.is-online { border-color: rgba(52,211,153,.35); }
        .op-device.is-online.is-selected { border-color: var(--op-accent); }

        .op-device__head { display: flex; align-items: center; gap: 8px; }
        .op-device__dot {
          width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
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
        .op-detail { display: flex; flex-direction: column; gap: 14px; }

        .op-badge {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 3px 9px; border-radius: 999px;
          font-size: 10.5px; font-weight: 700;
          white-space: nowrap;
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
          outline: none; transition: .15s;
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
          transition: .15s; white-space: nowrap;
        }
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

        /* bar */
        .op-bar {
          height: 8px; border-radius: 999px;
          background: var(--op-surface-3); overflow: hidden;
        }
        .op-bar__fill {
          height: 100%; border-radius: 999px;
          transition: width .3s;
        }
        .op-bar__fill--ok { background: var(--op-ok); }
        .op-bar__fill--warn { background: var(--op-warn); }
        .op-bar__fill--err { background: var(--op-accent); }

        /* rows */
        .op-row {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 0;
          border-bottom: 1px solid var(--op-border);
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
          transition: .18s;
        }
        .op-qa:hover:not(:disabled) .op-qa__btn {
          border-color: var(--op-accent);
          color: var(--op-accent);
          background: var(--op-accent-soft);
          transform: translateY(-2px);
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
        }

        /* empty */
        .op-empty {
          padding: 24px 8px; text-align: center;
          font-size: 13px; color: var(--op-muted);
        }

        /* ============ RESPONSIVE ============ */
        @media (max-width: 1080px) {
          .op-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .op-main-grid { grid-template-columns: minmax(0, 1fr); }
        }

        @media (max-width: 640px) {
          .op-nav { padding: 8px 12px; }
          .op-nav__status { display: none; }
          .op-brand small { display: none; }
          .op-brand { font-size: 13px; }
          .op-wrap { padding: 12px; gap: 12px; }
          .op-card { padding: 14px; border-radius: 14px; }
          .op-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
          .op-stat__value { font-size: 20px; }
          .op-device-grid { grid-template-columns: minmax(0, 1fr); }
          .op-seg button { padding: 6px 9px; font-size: 11px; }
          .op-qa__btn { width: 48px; height: 48px; }
          .op-info-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }

        @media (max-width: 400px) {
          .op-stats { grid-template-columns: minmax(0, 1fr); }
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
          <section className="op-stats">
            <StatCard
              label="Sesi Hari Ini"
              value={String(aggregatedStats.totalSessions)}
              delta={aggregatedStats.totalSessions > 0 ? `+${aggregatedStats.totalSessions}` : '±0'}
              deltaTone="up"
              spark="0,25 12,21 24,23 36,14 48,18 60,10 72,13 84,6 100,9"
            />
            <StatCard
              label="Foto Hari Ini"
              value={String(aggregatedStats.totalPhotos)}
              delta={aggregatedStats.totalPhotos > 0 ? `+${aggregatedStats.totalPhotos}` : '±0'}
              deltaTone="up"
              spark="0,21 12,23 24,17 36,19 48,12 60,15 72,9 84,11 100,5"
            />
            <StatCard
              label="Uploaded"
              value={String(aggregatedStats.totalUploaded)}
              delta={aggregatedStats.totalPending > 0 ? `${aggregatedStats.totalPending} pending` : 'Clean'}
              deltaTone={aggregatedStats.totalPending > 0 ? 'flat' : 'up'}
              spark="0,21 12,23 24,17 36,19 48,12 60,15 72,9 84,11 100,5"
              tone="ok"
            />
            <StatCard
              label="Failed"
              value={String(aggregatedStats.totalFailed)}
              delta={aggregatedStats.totalFailed === 0 ? 'Clean' : 'Perlu cek'}
              deltaTone={aggregatedStats.totalFailed === 0 ? 'up' : 'down'}
              spark="0,20 12,22 24,18 36,21 48,20 60,22 72,21 84,23 100,22"
              tone={aggregatedStats.totalFailed > 0 ? 'warn' : 'ok'}
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
                      {isDeviceOnline(selectedDevice) ? (
                        <span className="op-badge op-badge--ok">Online</span>
                      ) : (
                        <span className="op-badge op-badge--muted op-badge--plain">Offline</span>
                      )}
                    </div>

                    <div className="op-detail">
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
                      <div className="op-device-grid">
                        {filteredTablets.map((t) => {
                          const lastActivityAgo = Math.floor((Date.now() - t.lastActivity) / 1000);
                          const isStale = lastActivityAgo > 60;
                          const isOnline = t.online && !isStale;
                          const openDuration = t.eventOpenedAt > 0 ? Date.now() - t.eventOpenedAt : 0;
                          const hasCustomName = !!(t.deviceName && t.deviceName.trim());

                          return (
                            <div
                              key={t.deviceId}
                              onClick={() => setSelectedDeviceId(t.deviceId)}
                              className={`op-device ${isOnline ? 'is-online' : ''}`}
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

              {/* HEALTH SUMMARY */}
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
              </div>

              {/* STORAGE SUMMARY */}
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
  label, value, delta, deltaTone, spark, tone,
}: {
  label: string;
  value: string;
  delta: string;
  deltaTone: 'up' | 'down' | 'flat';
  spark: string;
  tone?: 'ok' | 'warn' | 'info';
}) => {
  const toneClass = tone ? `op-spark--${tone}` : '';
  return (
    <div className="op-card">
      <div className="op-stat__label">{label}</div>
      <div className="op-stat__row">
        <span className="op-stat__value">{value}</span>
        <span className={`op-stat__delta op-delta--${deltaTone}`}>{delta}</span>
      </div>
      <svg className={`op-spark ${toneClass}`} viewBox="0 0 100 32" preserveAspectRatio="none">
        <polyline points={spark} />
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