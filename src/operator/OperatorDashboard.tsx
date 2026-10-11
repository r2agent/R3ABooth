import { useEffect, useState, useCallback } from 'react';
import {
  RefreshCw,
  X,
  AlertCircle,
  CheckCircle2,
  Clock,
  Plug,
  Camera,
  Wifi,
  HardDrive,
  Printer,
  Cpu,
  Activity,
  Play,
  Trash2,
  Download,
  RotateCcw,
  FileText,
} from 'lucide-react';
import {
  getAllPendingUploads,
  getUploadStats,
  retryAllPending,
  type PendingUpload,
} from '../uploadService';
import { getTokenStatus, connectGoogleDrive, type TokenStatus } from '../gdriveService';
import {
  runFullDiagnostic,
  checkCamera,
  checkInternet,
  checkStorage,
  checkPrinter,
  checkMemory,
  getSystemInfo,
  getLogs,
  clearLogs,
  downloadLogs,
  pushLog,
  type DeviceCheck,
  type DeviceCheckStatus,
} from '../deviceDiagnostic';
import {
  getTodayStats,
  getLastSession,
  getAppUptimeMs,
  resetAppUptime,
  clearAllStats,
  type TodayStats,
} from '../sessionStats';
import type { AllSettings } from '../settingsStore';

const REFRESH_INTERVAL_MS = 3000;

/* ---------- HELPERS ---------- */
function statusColor(s: DeviceCheckStatus): string {
  switch (s) {
    case 'ok': return '#4ade80';
    case 'warning': return '#facc15';
    case 'error': return '#ef4444';
    case 'checking': return '#60a5fa';
    default: return 'rgba(255,255,255,.5)';
  }
}

function statusIcon(s: DeviceCheckStatus) {
  switch (s) {
    case 'ok': return <CheckCircle2 size={16} />;
    case 'warning': return <AlertCircle size={16} />;
    case 'error': return <AlertCircle size={16} />;
    case 'checking': return <RefreshCw size={16} className="spin" />;
    default: return <AlertCircle size={16} />;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}m ${remSec}s`;
  const hour = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hour}h ${remMin}m`;
}

function deviceIcon(id: string) {
  switch (id) {
    case 'camera': return <Camera size={18} />;
    case 'internet': return <Wifi size={18} />;
    case 'storage': return <HardDrive size={18} />;
    case 'printer': return <Printer size={18} />;
    case 'memory': return <Cpu size={18} />;
    default: return <Activity size={18} />;
  }
}

/* ---------- COMPONENT ---------- */
export const OperatorDashboard = ({
  allSettings,
  onClose,
}: {
  allSettings: AllSettings;
  onClose: () => void;
}) => {
  const [stats, setStats] = useState({ uploaded: 0, pending: 0, failed: 0 });
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [token, setToken] = useState<TokenStatus>({
    hasToken: false,
    expiresAt: null,
    expiresInMs: null,
    account: null,
  });
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [retrying, setRetrying] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Device status
  const [devices, setDevices] = useState<DeviceCheck[]>([
    { id: 'camera', label: 'Camera', status: 'unknown', detail: 'Belum dicek' },
    { id: 'internet', label: 'Internet', status: 'unknown', detail: 'Belum dicek' },
    { id: 'storage', label: 'Storage', status: 'unknown', detail: 'Belum dicek' },
    { id: 'printer', label: 'Printer', status: 'unknown', detail: 'Belum dicek' },
    { id: 'memory', label: 'Memory', status: 'unknown', detail: 'Belum dicek' },
  ]);
  const [diagnosing, setDiagnosing] = useState(false);

  // Stats
  const [todayStats, setTodayStats] = useState<TodayStats>({
    sessionCount: 0,
    photoCount: 0,
    uploadSuccess: 0,
    uploadFail: 0,
    avgDurationMs: 0,
  });
  const [uptimeMs, setUptimeMs] = useState(0);

  // Logs
  const [logs, setLogs] = useState(getLogs());

  const refresh = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        getUploadStats().catch(() => ({ uploaded: 0, pending: 0, failed: 0 })),
        getAllPendingUploads().catch(() => []),
      ]);
      setStats(s);
      setPending(p);
      setToken(getTokenStatus());
      setTodayStats(getTodayStats());
      setUptimeMs(getAppUptimeMs());
      setLogs(getLogs());
      setLastUpdate(new Date());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!actionMessage) return;
    const t = setTimeout(() => setActionMessage(null), 4000);
    return () => clearTimeout(t);
  }, [actionMessage]);

  /* ---------- ACTIONS ---------- */
  const handleRetryAll = useCallback(async () => {
    const clientId = allSettings.googleDrive.clientId;
    if (!clientId) {
      setActionMessage('No Client ID configured.');
      return;
    }
    if (pending.length === 0) {
      setActionMessage('No pending uploads.');
      return;
    }
    setRetrying(true);
    try {
      const succeeded = await retryAllPending(clientId);
      await refresh();
      setActionMessage(`Retried: ${succeeded} file(s) uploaded successfully.`);
      pushLog('info', `Retry all: ${succeeded} files uploaded`);
    } catch {
      setActionMessage('Retry failed. Check connection.');
      pushLog('error', 'Retry all failed');
    } finally {
      setRetrying(false);
    }
  }, [allSettings.googleDrive.clientId, pending.length, refresh]);

  const handleReconnect = useCallback(async () => {
    const clientId = allSettings.googleDrive.clientId;
    if (!clientId) {
      setActionMessage('No Client ID configured.');
      return;
    }
    setReconnecting(true);
    try {
      const result = await connectGoogleDrive(clientId);
      await refresh();
      if (result.success) {
        setActionMessage(`Reconnected as ${result.account || 'unknown account'}.`);
        pushLog('info', `Drive reconnected: ${result.account}`);
      } else {
        setActionMessage(`Reconnect failed: ${result.error || 'unknown error'}`);
        pushLog('error', `Drive reconnect failed: ${result.error}`);
      }
    } catch {
      setActionMessage('Reconnect failed.');
      pushLog('error', 'Drive reconnect exception');
    } finally {
      setReconnecting(false);
    }
  }, [allSettings.googleDrive.clientId, refresh]);

  const handleDiagnostic = useCallback(async () => {
    setDiagnosing(true);
    pushLog('info', 'Running full diagnostic...');
    try {
      // Set checking state
      setDevices((prev) => prev.map((d) => ({ ...d, status: 'checking', detail: 'Checking...' })));
      const results = await runFullDiagnostic();
      setDevices(results);
      pushLog('info', `Diagnostic complete: ${results.filter((r) => r.status === 'ok').length}/${results.length} OK`);
      setActionMessage('Diagnostic selesai.');
    } catch {
      pushLog('error', 'Diagnostic failed');
      setActionMessage('Diagnostic gagal.');
    } finally {
      setDiagnosing(false);
    }
  }, []);

  const handleQuickCheckCamera = useCallback(async () => {
    const result = await checkCamera();
    setDevices((prev) => prev.map((d) => (d.id === 'camera' ? result : d)));
    pushLog('info', `Camera check: ${result.detail}`);
  }, []);

  const handleQuickCheckInternet = useCallback(async () => {
    const result = await checkInternet();
    setDevices((prev) => prev.map((d) => (d.id === 'internet' ? result : d)));
    pushLog('info', `Internet check: ${result.detail}`);
  }, []);

  const handleQuickCheckStorage = useCallback(async () => {
    const result = await checkStorage();
    setDevices((prev) => prev.map((d) => (d.id === 'storage' ? result : d)));
    pushLog('info', `Storage check: ${result.detail}`);
  }, []);

  const handleQuickCheckPrinter = useCallback(() => {
    const result = checkPrinter();
    setDevices((prev) => prev.map((d) => (d.id === 'printer' ? result : d)));
    pushLog('info', `Printer check: ${result.detail}`);
  }, []);

  const handleQuickCheckMemory = useCallback(() => {
    const result = checkMemory();
    setDevices((prev) => prev.map((d) => (d.id === 'memory' ? result : d)));
    pushLog('info', `Memory check: ${result.detail}`);
  }, []);

  const handleClearCache = useCallback(() => {
    try {
      // Clear session storage & cache (jangan localStorage karena ada stats)
      sessionStorage.clear();
      pushLog('info', 'Session storage cleared');
      setActionMessage('Cache dibersihkan. Reload halaman untuk efek penuh.');
    } catch {
      setActionMessage('Gagal clear cache.');
    }
  }, []);

  const handleResetUptime = useCallback(() => {
    resetAppUptime();
    setUptimeMs(0);
    pushLog('info', 'Uptime counter di-reset');
    setActionMessage('Uptime di-reset.');
  }, []);

  const handleClearStats = useCallback(() => {
    if (!confirm('Hapus semua statistik sesi? Tindakan ini tidak bisa dibatalkan.')) return;
    clearAllStats();
    setTodayStats(getTodayStats());
    pushLog('info', 'All stats cleared');
    setActionMessage('Statistik dihapus.');
  }, []);

  const handleDownloadLogs = useCallback(() => {
    downloadLogs();
    pushLog('info', 'Logs downloaded');
    setActionMessage('Log di-download.');
  }, []);

  const handleClearLogs = useCallback(() => {
    clearLogs();
    setLogs(getLogs());
    setActionMessage('Log dibersihkan.');
  }, []);

  const handleReloadApp = useCallback(() => {
    if (!confirm('Reload aplikasi sekarang?')) return;
    pushLog('info', 'App reloading...');
    window.location.reload();
  }, []);

  const tokenExpiresIn = token.expiresInMs
    ? Math.max(0, Math.floor(token.expiresInMs / 60000))
    : 0;

  const systemInfo = getSystemInfo();
  const lastSession = getLastSession();

  /* ---------- RENDER ---------- */
  return (
    <main
      className="photobooth-screen photobooth-kiosk"
      style={{ padding: 24, overflow: 'auto', minHeight: '100vh' }}
    >
      <div className="photobooth-kiosk-header">
        <div className="photobooth-project">
          <span>R3A BOOTH</span>
          <strong>OPERATOR DASHBOARD</strong>
        </div>
        <button className="photobooth-exit" onClick={onClose} type="button">
          <X size={24} /> CLOSE
        </button>
      </div>

      <p style={{ color: 'rgba(255,255,255,.5)', fontSize: 13, margin: '0 0 16px' }}>
        Last update: {lastUpdate.toLocaleTimeString()} • Uptime: {formatDuration(uptimeMs)}
      </p>

      {actionMessage ? (
        <div
          style={{
            padding: '10px 14px',
            background: 'rgba(239,63,37,.15)',
            border: '1px solid rgba(239,63,37,.4)',
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {actionMessage}
        </div>
      ) : null}

      {/* ============ DEVICE STATUS ============ */}
      <section style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 14, letterSpacing: '.1em' }}>
            DEVICE STATUS
          </h3>
          <button
            onClick={handleDiagnostic}
            disabled={diagnosing}
            type="button"
            style={{
              padding: '8px 16px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              fontWeight: 600,
              fontSize: 12,
              cursor: diagnosing ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Activity size={14} /> {diagnosing ? 'CHECKING...' : 'RUN FULL DIAGNOSTIC'}
          </button>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 10,
          }}
        >
          {devices.map((d) => (
            <div
              key={d.id}
              style={{
                border: '1px solid rgba(255,255,255,.1)',
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'rgba(255,255,255,.6)' }}>{deviceIcon(d.id)}</span>
                <span style={{ fontSize: 12, letterSpacing: '.08em', color: 'rgba(255,255,255,.6)' }}>
                  {d.label.toUpperCase()}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: statusColor(d.status), fontSize: 14, fontWeight: 600 }}>
                {statusIcon(d.status)}
                {d.status === 'ok' ? 'OK' : d.status === 'warning' ? 'WARN' : d.status === 'error' ? 'ERROR' : '—'}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)' }}>{d.detail}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ============ TODAY STATS ============ */}
      <section style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, letterSpacing: '.1em' }}>
          STATISTIK HARI INI
        </h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 10,
          }}
        >
          <StatCard label="Sesi" value={String(todayStats.sessionCount)} color="#60a5fa" />
          <StatCard label="Foto" value={String(todayStats.photoCount)} color="#a78bfa" />
          <StatCard label="Uploaded" value={String(todayStats.uploadSuccess)} color="#4ade80" />
          <StatCard label="Upload Fail" value={String(todayStats.uploadFail)} color="#ef4444" />
          <StatCard
            label="Avg Durasi"
            value={todayStats.avgDurationMs > 0 ? formatDuration(todayStats.avgDurationMs) : '—'}
            color="#facc15"
          />
        </div>
        {lastSession ? (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'rgba(255,255,255,.5)' }}>
            Sesi terakhir: {new Date(lastSession.finishedAt).toLocaleTimeString()} • {lastSession.photoCount} foto • {formatDuration(lastSession.finishedAt - lastSession.startedAt)}
          </p>
        ) : null}
      </section>

      {/* ============ DRIVE + UPLOAD STATUS ============ */}
      <section style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', marginBottom: 16 }}>
        <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, letterSpacing: '.1em' }}>
            DRIVE STATUS
          </h3>
          <p style={{ margin: 4, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            {token.hasToken ? (
              <><CheckCircle2 size={14} color="#4ade80" /> Connected</>
            ) : (
              <><AlertCircle size={14} color="#ef4444" /> Not connected</>
            )}
          </p>
          <p style={{ margin: 4, fontSize: 13, color: 'rgba(255,255,255,.6)' }}>
            Account: {token.account || '—'}
          </p>
          <p style={{ margin: 4, fontSize: 13, color: 'rgba(255,255,255,.6)' }}>
            Token expires in: {token.hasToken ? `${tokenExpiresIn} min` : '—'}
          </p>
        </div>

        <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, letterSpacing: '.1em' }}>
            UPLOAD STATUS
          </h3>
          <p style={{ margin: 4, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <CheckCircle2 size={14} color="#4ade80" /> Uploaded: {stats.uploaded}
          </p>
          <p style={{ margin: 4, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={14} color="#facc15" /> Pending: {stats.pending}
          </p>
          <p style={{ margin: 4, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={14} color="#ef4444" /> Failed: {stats.failed}
          </p>
        </div>
      </section>

      {/* ============ PENDING LIST ============ */}
      <section style={{ marginBottom: 16, border: '1px solid rgba(255,255,255,.1)', padding: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, letterSpacing: '.1em' }}>
          PENDING LIST ({pending.length})
        </h3>
        {pending.length === 0 ? (
          <p style={{ color: 'rgba(255,255,255,.5)', fontSize: 13, margin: 0 }}>
            No pending uploads. All good.
          </p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              maxHeight: 240,
              overflow: 'auto',
            }}
          >
            {pending.slice(0, 50).map((p) => (
              <li
                key={p.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                  borderBottom: '1px solid rgba(255,255,255,.05)',
                  fontSize: 13,
                }}
              >
                <span>{p.fileName}</span>
                <span style={{ color: 'rgba(255,255,255,.5)' }}>
                  {new Date(p.createdAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ============ QUICK ACTIONS ============ */}
      <section style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, letterSpacing: '.1em' }}>
          QUICK ACTIONS
        </h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <ActionButton
            icon={<RefreshCw size={16} />}
            label={retrying ? 'RETRYING...' : 'RETRY ALL'}
            onClick={handleRetryAll}
            disabled={retrying || pending.length === 0}
            color="#ef3f25"
          />
          <ActionButton
            icon={<Plug size={16} />}
            label={reconnecting ? 'CONNECTING...' : 'RECONNECT DRIVE'}
            onClick={handleReconnect}
            disabled={reconnecting}
            color="#2563eb"
          />
          <ActionButton
            icon={<Camera size={16} />}
            label="CHECK CAMERA"
            onClick={handleQuickCheckCamera}
            color="#0ea5e9"
          />
          <ActionButton
            icon={<Wifi size={16} />}
            label="CHECK INTERNET"
            onClick={handleQuickCheckInternet}
            color="#0ea5e9"
          />
          <ActionButton
            icon={<HardDrive size={16} />}
            label="CHECK STORAGE"
            onClick={handleQuickCheckStorage}
            color="#0ea5e9"
          />
          <ActionButton
            icon={<Printer size={16} />}
            label="CHECK PRINTER"
            onClick={handleQuickCheckPrinter}
            color="#0ea5e9"
          />
          <ActionButton
            icon={<Cpu size={16} />}
            label="CHECK MEMORY"
            onClick={handleQuickCheckMemory}
            color="#0ea5e9"
          />
          <ActionButton
            icon={<Trash2 size={16} />}
            label="CLEAR CACHE"
            onClick={handleClearCache}
            color="#6b7280"
          />
          <ActionButton
            icon={<RotateCcw size={16} />}
            label="RESET UPTIME"
            onClick={handleResetUptime}
            color="#6b7280"
          />
          <ActionButton
            icon={<Trash2 size={16} />}
            label="CLEAR STATS"
            onClick={handleClearStats}
            color="#6b7280"
          />
          <ActionButton
            icon={<Download size={16} />}
            label="DOWNLOAD LOGS"
            onClick={handleDownloadLogs}
            color="#6b7280"
          />
          <ActionButton
            icon={<FileText size={16} />}
            label="CLEAR LOGS"
            onClick={handleClearLogs}
            color="#6b7280"
          />
          <ActionButton
            icon={<Play size={16} />}
            label="RELOAD APP"
            onClick={handleReloadApp}
            color="#dc2626"
          />
        </div>
      </section>

      {/* ============ SYSTEM INFO ============ */}
      <section style={{ marginBottom: 16, border: '1px solid rgba(255,255,255,.1)', padding: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, letterSpacing: '.1em' }}>
          SYSTEM INFO
        </h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 8,
          }}
        >
          {systemInfo.map((info) => (
            <div key={info.label} style={{ fontSize: 12, display: 'flex', gap: 8 }}>
              <span style={{ color: 'rgba(255,255,255,.5)', minWidth: 90 }}>
                {info.label}:
              </span>
              <span style={{ color: 'rgba(255,255,255,.8)' }}>{info.value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ============ LOGS ============ */}
      <section style={{ marginBottom: 16, border: '1px solid rgba(255,255,255,.1)', padding: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, letterSpacing: '.1em' }}>
          RECENT LOGS ({logs.length})
        </h3>
        {logs.length === 0 ? (
          <p style={{ color: 'rgba(255,255,255,.5)', fontSize: 13, margin: 0 }}>
            Belum ada log.
          </p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              maxHeight: 240,
              overflow: 'auto',
              fontFamily: 'monospace',
              fontSize: 12,
            }}
          >
            {logs.slice(0, 50).map((l, i) => (
              <li
                key={i}
                style={{
                  padding: '4px 0',
                  borderBottom: '1px solid rgba(255,255,255,.05)',
                  color:
                    l.level === 'error'
                      ? '#ef4444'
                      : l.level === 'warn'
                      ? '#facc15'
                      : 'rgba(255,255,255,.7)',
                }}
              >
                [{new Date(l.time).toLocaleTimeString()}] [{l.level.toUpperCase()}] {l.message}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
};

/* ---------- SUB COMPONENTS ---------- */
const StatCard = ({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) => (
  <div
    style={{
      border: '1px solid rgba(255,255,255,.1)',
      padding: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}
  >
    <span style={{ fontSize: 11, letterSpacing: '.1em', color: 'rgba(255,255,255,.5)' }}>
      {label.toUpperCase()}
    </span>
    <span style={{ fontSize: 22, fontWeight: 700, color }}>{value}</span>
  </div>
);

const ActionButton = ({
  icon,
  label,
  onClick,
  disabled,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  color: string;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    type="button"
    style={{
      padding: '10px 16px',
      background: disabled ? '#555' : color,
      color: '#fff',
      border: 'none',
      fontWeight: 600,
      fontSize: 12,
      cursor: disabled ? 'not-allowed' : 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      opacity: disabled ? 0.5 : 1,
    }}
  >
    {icon} {label}
  </button>
);