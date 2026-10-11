import { useEffect, useState, useCallback } from 'react';
import {
  RefreshCw,
  X,
  ChevronLeft,
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
  Smartphone,
  Tablet,
  Monitor,
  Globe,
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
import {
  subscribeAllTablets,
  sendCommand,
  type TabletStatus,
  type CommandType,
} from '../statusSync';
import { formatDeviceType } from '../deviceInfo';

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
    case 'checking': return <RefreshCw size={16} />;
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

function deviceTypeIcon(type: string) {
  if (type === 'mobile') return <Smartphone size={16} />;
  if (type === 'tablet') return <Tablet size={16} />;
  return <Monitor size={16} />;
}

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
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  /* ============================================================
     LIVE DEVICES
     ============================================================ */
  const [tablets, setTablets] = useState<TabletStatus[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeAllTablets((newTablets) => {
      setTablets(newTablets);
      setLastUpdate(new Date());
    });
    return unsubscribe;
  }, []);

  const filteredTablets = eventSlug
    ? tablets.filter((t) => t.currentEventSlug === eventSlug)
    : tablets;

  const selectedDevice = filteredTablets.find((t) => t.deviceId === selectedDeviceId) ?? null;

  /* ============================================================
     AGREGAT STATISTIK — sum semua device
     ============================================================ */
  const aggregatedStats = (() => {
    let totalSessions = 0;
    let totalPhotos = 0;
    let totalUploaded = 0;
    let totalPending = 0;
    let totalFailed = 0;

    for (const t of filteredTablets) {
      totalSessions += t.todaySessionCount ?? 0;
      totalPhotos += t.todayPhotoCount ?? 0;
      totalUploaded += t.uploadedCount ?? 0;
      totalPending += t.pendingCount ?? 0;
      totalFailed += t.failedCount ?? 0;
    }

    return { totalSessions, totalPhotos, totalUploaded, totalPending, totalFailed };
  })();

  /* Override body min-width saat operator open */
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
    const id = setInterval(() => setLastUpdate(new Date()), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!actionMessage) return;
    const t = setTimeout(() => setActionMessage(null), 4000);
    return () => clearTimeout(t);
  }, [actionMessage]);

  /* ============================================================
     QUICK ACTIONS — kirim command ke device yang di-select
     ============================================================ */
  const handleCommand = useCallback(async (type: CommandType, label: string) => {
    if (!selectedDevice) {
      setActionMessage('Pilih device dulu.');
      return;
    }
    const ok = await sendCommand(selectedDevice.deviceId, type);
    if (ok) {
      setActionMessage(`✅ Perintah "${label}" dikirim ke ${selectedDevice.deviceName}.`);
    } else {
      setActionMessage(`❌ Gagal kirim perintah ke ${selectedDevice.deviceName}.`);
    }
  }, [selectedDevice]);

  return (
    <>
      <style>{`
        body:has(.operator-dashboard) { min-width: 0 !important; overflow: auto !important; }
        .operator-dashboard { padding: 24px; overflow: auto; min-height: 100vh; }
        .device-card { transition: border-color .18s, background .18s; cursor: pointer; }
        .device-card:hover { border-color: rgba(255,217,78,.5) !important; background: rgba(255,217,78,.04) !important; }
        .device-card.is-selected { border-color: #ffd94e !important; background: rgba(255,217,78,.08) !important; box-shadow: 0 0 0 1px rgba(255,217,78,.3); }

        @media (max-width: 768px) {
          .operator-dashboard { padding: 12px !important; }
          .operator-dashboard .photobooth-kiosk-header { padding: 12px 14px !important; flex-wrap: wrap; gap: 10px; }
          .operator-dashboard .photobooth-kiosk-header .photobooth-project strong { font-size: 13px !important; }
          .operator-dashboard .photobooth-kiosk-header .photobooth-exit { padding: 8px 12px !important; font-size: 11px !important; }
          .operator-dashboard h3 { font-size: 12px !important; }
          .op-grid { grid-template-columns: 1fr !important; }
          .op-grid-stats { grid-template-columns: repeat(2, 1fr) !important; }
          .op-grid-device { grid-template-columns: repeat(2, 1fr) !important; }
          .op-grid-tablets { grid-template-columns: 1fr !important; }
          .op-stat-value { font-size: 18px !important; }
          .op-log-list { font-size: 10px !important; }
          .op-action-btn { padding: 8px 12px !important; font-size: 11px !important; }
        }
        @media (max-width: 480px) {
          .op-grid-stats { grid-template-columns: 1fr !important; }
          .op-grid-device { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <main className="photobooth-screen photobooth-kiosk operator-dashboard">
        {/* HEADER */}
        <div className="photobooth-kiosk-header">
          <div className="photobooth-project">
            <span>R3A BOOTH</span>
            <strong>
              OPERATOR DASHBOARD
              {eventSlug ? <span style={{ color: '#ffd94e', marginLeft: 8 }}>— {eventSlug}</span> : null}
            </strong>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {onBackToPhotobooth && eventSlug ? (
              <button
                className="photobooth-exit"
                onClick={onBackToPhotobooth}
                type="button"
                style={{ background: '#4ade80', color: '#000', borderColor: 'transparent' }}
              >
                <ChevronLeft size={24} /> BACK TO PHOTOBOOTH
              </button>
            ) : null}
            <button className="photobooth-exit" onClick={onClose} type="button">
              <X size={24} /> CLOSE
            </button>
          </div>
        </div>

        <p style={{ color: 'rgba(255,255,255,.5)', fontSize: 12, margin: '0 0 16px' }}>
          Last update: {lastUpdate.toLocaleTimeString()}
        </p>

        {actionMessage ? (
          <div style={{ padding: '10px 14px', background: 'rgba(239,63,37,.15)', border: '1px solid rgba(239,63,37,.4)', marginBottom: 16, fontSize: 13, wordBreak: 'break-word' }}>
            {actionMessage}
          </div>
        ) : null}

        {/* ============ LIVE DEVICES ============ */}
        <section style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, letterSpacing: '.1em' }}>
            LIVE DEVICES ({filteredTablets.length})
            {eventSlug ? <span style={{ color: '#ffd94e', marginLeft: 8, fontSize: 12 }}>• Event: {eventSlug}</span> : null}
          </h3>
          {filteredTablets.length === 0 ? (
            <p style={{ color: 'rgba(255,255,255,.5)', fontSize: 13, margin: 0 }}>
              {eventSlug ? `Tidak ada device online untuk event "${eventSlug}".` : 'Tidak ada device online.'}
            </p>
          ) : (
            <div className="op-grid-tablets" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
              {filteredTablets.map((t) => {
                const lastActivityAgo = Math.floor((Date.now() - t.lastActivity) / 1000);
                const isStale = lastActivityAgo > 60;
                const isOnline = t.online && !isStale;
                const isSelected = selectedDeviceId === t.deviceId;

                return (
                  <div
                    key={t.deviceId}
                    onClick={() => setSelectedDeviceId(isSelected ? null : t.deviceId)}
                    className={`device-card ${isSelected ? 'is-selected' : ''}`}
                    style={{
                      border: `1px solid ${isOnline ? 'rgba(74,222,128,.4)' : 'rgba(255,255,255,.1)'}`,
                      padding: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      background: isOnline ? 'rgba(74,222,128,.05)' : 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: isOnline ? '#4ade80' : '#6b7280', flexShrink: 0 }} />
                      <strong style={{ fontSize: 13, color: '#fff', wordBreak: 'break-word', flex: 1 }}>
                        {t.deviceName}
                      </strong>
                      <span style={{ color: 'rgba(255,255,255,.6)' }} title={formatDeviceType(t.deviceType || 'unknown')}>
                        {deviceTypeIcon(t.deviceType || 'desktop')}
                      </span>
                    </div>

                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)' }}>
                      {formatDeviceType(t.deviceType || 'unknown')}
                      {t.browser ? ` • ${t.browser}` : ''}
                      {t.os ? ` • ${t.os}` : ''}
                    </div>

                    {t.currentEventName ? (
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.7)', wordBreak: 'break-word' }}>
                        📸 {t.currentEventName}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)' }}>Belum ada event</div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'rgba(255,255,255,.5)' }}>Phase:</span>
                      <span style={{ color: '#ffd94e', fontWeight: 600 }}>{t.currentPhase.toUpperCase()}</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'rgba(255,255,255,.5)' }}>Foto:</span>
                      <span style={{ color: '#fff' }}>{t.photoCount} / {t.totalCaptures}</span>
                    </div>

                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 4 }}>
                      {isStale ? `⚠️ ${lastActivityAgo}s tidak aktif` : `✅ Aktif ${lastActivityAgo}s lalu`}
                    </div>

                    {isSelected ? (
                      <div style={{ marginTop: 6, fontSize: 10, color: '#ffd94e', textAlign: 'right' }}>
                        ▼ TERPILIH
                      </div>
                    ) : (
                      <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(255,255,255,.3)', textAlign: 'right' }}>
                        Klik untuk pilih
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ============ DEVICE DETAIL ============ */}
        {selectedDevice ? (
          <section style={{ marginBottom: 16, border: '2px solid rgba(255,217,78,.4)', padding: 16, background: 'rgba(255,217,78,.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', letterSpacing: '.1em', marginBottom: 4 }}>
                  DEVICE DETAIL — TERPILIH
                </div>
                <h3 style={{ margin: 0, fontSize: 18, color: '#fff' }}>
                  {selectedDevice.deviceName}
                </h3>
              </div>
              <button
                onClick={() => setSelectedDeviceId(null)}
                type="button"
                style={{
                  padding: '8px 16px',
                  background: 'rgba(255,255,255,.1)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,.2)',
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <X size={14} /> BATAL PILIH
              </button>
            </div>

            {/* Identitas Device */}
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 10px', fontSize: 12, letterSpacing: '.1em', color: 'rgba(255,255,255,.5)' }}>
                IDENTITAS DEVICE
              </h4>
              <div className="op-grid-device" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span style={{ color: 'rgba(255,255,255,.5)' }}>{deviceTypeIcon(selectedDevice.deviceType || 'desktop')}</span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', letterSpacing: '.06em' }}>TIPE</span>
                  </div>
                  <strong style={{ fontSize: 14, color: '#fff' }}>{formatDeviceType(selectedDevice.deviceType || 'unknown')}</strong>
                </div>

                <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Globe size={16} style={{ color: 'rgba(255,255,255,.5)' }} />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', letterSpacing: '.06em' }}>BROWSER</span>
                  </div>
                  <strong style={{ fontSize: 14, color: '#fff' }}>{selectedDevice.browser || '—'}</strong>
                </div>

                <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Monitor size={16} style={{ color: 'rgba(255,255,255,.5)' }} />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', letterSpacing: '.06em' }}>OS</span>
                  </div>
                  <strong style={{ fontSize: 14, color: '#fff' }}>{selectedDevice.os || '—'}</strong>
                </div>

                <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Monitor size={16} style={{ color: 'rgba(255,255,255,.5)' }} />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', letterSpacing: '.06em' }}>SCREEN</span>
                  </div>
                  <strong style={{ fontSize: 14, color: '#fff' }}>{selectedDevice.screenSize || '—'}</strong>
                </div>
              </div>
            </div>

            {/* Storage & Drive Device */}
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 10px', fontSize: 12, letterSpacing: '.1em', color: 'rgba(255,255,255,.5)' }}>
                STORAGE & DRIVE (DEVICE INI)
              </h4>
              <div className="op-grid" style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
                <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: 16 }}>
                  <h5 style={{ margin: '0 0 12px', fontSize: 12, letterSpacing: '.1em', color: 'rgba(255,255,255,.5)' }}>
                    DRIVE STATUS
                  </h5>
                  <p style={{ margin: 4, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {selectedDevice.driveConnected ? (
                      <><CheckCircle2 size={14} color="#4ade80" /> Connected</>
                    ) : (
                      <><AlertCircle size={14} color="#ef4444" /> Not connected</>
                    )}
                  </p>
                  <p style={{ margin: 4, fontSize: 13, color: 'rgba(255,255,255,.6)', wordBreak: 'break-word' }}>
                    Account: {selectedDevice.driveAccount || '—'}
                  </p>
                </div>

                <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: 16 }}>
                  <h5 style={{ margin: '0 0 12px', fontSize: 12, letterSpacing: '.1em', color: 'rgba(255,255,255,.5)' }}>
                    UPLOAD STATUS
                  </h5>
                  <p style={{ margin: 4, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckCircle2 size={14} color="#4ade80" /> Uploaded: {selectedDevice.uploadedCount ?? 0}
                  </p>
                  <p style={{ margin: 4, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Clock size={14} color="#facc15" /> Pending: {selectedDevice.pendingCount ?? 0}
                  </p>
                  <p style={{ margin: 4, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertCircle size={14} color="#ef4444" /> Failed: {selectedDevice.failedCount ?? 0}
                  </p>
                </div>
              </div>
            </div>

            {/* Quick Actions (untuk device terpilih) */}
            <div style={{ marginTop: 20 }}>
              <h4 style={{ margin: '0 0 12px', fontSize: 12, letterSpacing: '.1em', color: '#ffd94e' }}>
                ⚡ QUICK ACTIONS → {selectedDevice.deviceName.toUpperCase()}
              </h4>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <ActionButton
                  icon={<RefreshCw size={16} />}
                  label="RETRY UPLOAD"
                  onClick={() => handleCommand('retry-all', 'Retry Upload')}
                  color="#ef3f25"
                />
                <ActionButton
                  icon={<Trash2 size={16} />}
                  label="CLEAR CACHE"
                  onClick={() => handleCommand('clear-cache', 'Clear Cache')}
                  color="#6b7280"
                />
                <ActionButton
                  icon={<RotateCcw size={16} />}
                  label="RESET UPTIME"
                  onClick={() => handleCommand('reset-uptime', 'Reset Uptime')}
                  color="#6b7280"
                />
                <ActionButton
                  icon={<Trash2 size={16} />}
                  label="CLEAR STATS"
                  onClick={() => handleCommand('clear-stats', 'Clear Stats')}
                  color="#6b7280"
                />
                <ActionButton
                  icon={<Download size={16} />}
                  label="DOWNLOAD LOGS"
                  onClick={() => handleCommand('download-logs', 'Download Logs')}
                  color="#6b7280"
                />
                <ActionButton
                  icon={<Play size={16} />}
                  label="RELOAD APP"
                  onClick={() => handleCommand('reload-app', 'Reload App')}
                  color="#dc2626"
                />
              </div>
              <p style={{ margin: '12px 0 0', fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
                ⚠️ Perintah dikirim ke device terpilih. Device akan eksekusi dalam ~1 detik.
              </p>
            </div>
          </section>
        ) : null}

        {/* ============ STATISTIK KESELURUHAN ============ */}
        <section style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, letterSpacing: '.1em' }}>
            STATISTIK HARI INI (SEMUA BOOTH)
          </h3>
          <div className="op-grid-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
            <StatCard label="Total Sesi" value={String(aggregatedStats.totalSessions)} color="#60a5fa" />
            <StatCard label="Total Foto" value={String(aggregatedStats.totalPhotos)} color="#a78bfa" />
            <StatCard label="Uploaded" value={String(aggregatedStats.totalUploaded)} color="#4ade80" />
            <StatCard label="Pending" value={String(aggregatedStats.totalPending)} color="#facc15" />
            <StatCard label="Failed" value={String(aggregatedStats.totalFailed)} color="#ef4444" />
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
            * Dihitung dari {filteredTablets.length} device aktif
          </p>
        </section>

        {/* ============ LOGS (LOCAL OPERATOR) ============ */}
        <section style={{ marginBottom: 16, border: '1px solid rgba(255,255,255,.1)', padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, letterSpacing: '.1em' }}>
            LOGS (DEVICE OPERATOR)
          </h3>
          {getLogs().length === 0 ? (
            <p style={{ color: 'rgba(255,255,255,.5)', fontSize: 13, margin: 0 }}>Belum ada log.</p>
          ) : (
            <ul className="op-log-list" style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 240, overflow: 'auto', fontFamily: 'monospace', fontSize: 12 }}>
              {getLogs().slice(0, 50).map((l, i) => (
                <li key={i} style={{ padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,.05)', color: l.level === 'error' ? '#ef4444' : l.level === 'warn' ? '#facc15' : 'rgba(255,255,255,.7)', wordBreak: 'break-word' }}>
                  [{new Date(l.time).toLocaleTimeString()}] [{l.level.toUpperCase()}] {l.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
};

/* ---------- SUB COMPONENTS ---------- */
const StatCard = ({ label, value, color }: { label: string; value: string; color: string }) => (
  <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ fontSize: 11, letterSpacing: '.1em', color: 'rgba(255,255,255,.5)' }}>{label.toUpperCase()}</span>
    <span className="op-stat-value" style={{ fontSize: 22, fontWeight: 700, color }}>{value}</span>
  </div>
);

const ActionButton = ({ icon, label, onClick, disabled, color }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; color: string }) => (
  <button onClick={onClick} disabled={disabled} type="button" className="op-action-btn" style={{ padding: '10px 16px', background: disabled ? '#555' : color, color: '#fff', border: 'none', fontWeight: 600, fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: disabled ? 0.5 : 1 }}>
    {icon} {label}
  </button>
);