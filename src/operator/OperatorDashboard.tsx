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
  Key,
  Maximize2,
} from 'lucide-react';
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
  const now = Date.now();
  const diff = expiresAt - now;
  if (diff <= 0) return '⚠️ EXPIRED';
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min} menit lagi`;
  const hour = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hour}j ${remMin}m lagi`;
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
  const [, setTick] = useState(0);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const [tablets, setTablets] = useState<TabletStatus[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeAllTablets((newTablets) => {
      setTablets(newTablets);
    });
    return unsubscribe;
  }, []);

  /* Force re-render tiap 1 detik biar durasi update */
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const filteredTablets = eventSlug
    ? tablets.filter((t) => t.currentEventSlug === eventSlug)
    : tablets;

  const selectedDevice = filteredTablets.find((t) => t.deviceId === selectedDeviceId) ?? null;

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
    if (ok) {
      setActionMessage(`✅ Perintah "${label}" dikirim ke ${selectedDevice.browser}.`);
    } else {
      setActionMessage(`❌ Gagal kirim perintah.`);
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
        .info-row { display: flex; justify-content: space-between; font-size: 12px; gap: 8px; }
        .info-row span:first-child { color: rgba(255,255,255,.5); }
        .info-row span:last-child { color: #fff; text-align: right; word-break: break-word; }
        @media (max-width: 768px) {
          .operator-dashboard { padding: 12px !important; }
          .op-grid { grid-template-columns: 1fr !important; }
          .op-grid-stats { grid-template-columns: repeat(2, 1fr) !important; }
          .op-grid-device { grid-template-columns: repeat(2, 1fr) !important; }
          .op-grid-tablets { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <main className="photobooth-screen photobooth-kiosk operator-dashboard">
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
          Live update tiap 1 detik
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
            <div className="op-grid-tablets" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
              {filteredTablets.map((t) => {
                const lastActivityAgo = Math.floor((Date.now() - t.lastActivity) / 1000);
                const isStale = lastActivityAgo > 60;
                const isOnline = t.online && !isStale;
                const isSelected = selectedDeviceId === t.deviceId;

                /* Durasi = waktu sekarang - eventOpenedAt */
                const openDuration = t.eventOpenedAt > 0
                  ? Date.now() - t.eventOpenedAt
                  : 0;

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
                        {t.browser || 'Browser'} - {formatDeviceType(t.deviceType || 'unknown')} - {t.os || 'OS'}
                      </strong>
                      <span style={{ color: 'rgba(255,255,255,.6)' }}>
                        {deviceTypeIcon(t.deviceType || 'desktop')}
                      </span>
                    </div>

                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
                      ID: {t.deviceId.slice(-8)}
                    </div>

                    {t.currentEventName ? (
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.7)' }}>
                        📸 {t.currentEventName}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)' }}>Belum ada event</div>
                    )}

                    <div className="info-row">
                      <span>Phase:</span>
                      <span style={{ color: '#ffd94e', fontWeight: 600 }}>{t.currentPhase.toUpperCase()}</span>
                    </div>

                    <div className="info-row">
                      <span>Foto:</span>
                      <span>{t.photoCount} / {t.totalCaptures}</span>
                    </div>

                    {openDuration > 0 ? (
                      <div className="info-row">
                        <span>Buka event:</span>
                        <span>{formatDuration(openDuration)}</span>
                      </div>
                    ) : null}

                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 4 }}>
                      {isStale ? `⚠️ ${lastActivityAgo}s tidak aktif` : `✅ Aktif ${lastActivityAgo}s lalu`}
                    </div>

                    <div style={{ marginTop: 6, fontSize: 10, color: isSelected ? '#ffd94e' : 'rgba(255,255,255,.3)', textAlign: 'right' }}>
                      {isSelected ? '▼ TERPILIH' : 'Klik untuk pilih'}
                    </div>
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
                  DEVICE DETAIL
                </div>
                <h3 style={{ margin: 0, fontSize: 18, color: '#fff' }}>
                  {selectedDevice.browser} - {formatDeviceType(selectedDevice.deviceType || 'unknown')} - {selectedDevice.os}
                </h3>
              </div>
              <button
                onClick={() => setSelectedDeviceId(null)}
                type="button"
                style={{ padding: '8px 16px', background: 'rgba(255,255,255,.1)', color: '#fff', border: '1px solid rgba(255,255,255,.2)', fontWeight: 600, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <X size={14} /> BATAL
              </button>
            </div>

            {/* Identitas */}
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 10px', fontSize: 12, letterSpacing: '.1em', color: 'rgba(255,255,255,.5)' }}>
                IDENTITAS DEVICE
              </h4>
              <div className="op-grid-device" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                <InfoCard icon={<Monitor size={16} />} label="TIPE" value={formatDeviceType(selectedDevice.deviceType || 'unknown')} />
                <InfoCard icon={<Globe size={16} />} label="BROWSER" value={selectedDevice.browser || '—'} />
                <InfoCard icon={<Monitor size={16} />} label="OS" value={selectedDevice.os || '—'} />
                <InfoCard icon={<Monitor size={16} />} label="SCREEN" value={selectedDevice.screenSize || '—'} />
              </div>
            </div>

            {/* Storage DRIVE Device */}
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 10px', fontSize: 12, letterSpacing: '.1em', color: 'rgba(255,255,255,.5)' }}>
                STORAGE GOOGLE DRIVE (DEVICE INI)
              </h4>
              {selectedDevice.driveConnected && selectedDevice.driveLimit > 0 ? (
                <>
                  <div className="op-grid-device" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 10 }}>
                    <InfoCard icon={<HardDrive size={16} />} label="FREE" value={formatBytes(Math.max(0, selectedDevice.driveLimit - selectedDevice.driveUsage))} color="#4ade80" />
                    <InfoCard icon={<HardDrive size={16} />} label="USED" value={formatBytes(selectedDevice.driveUsage)} color="#facc15" />
                    <InfoCard icon={<HardDrive size={16} />} label="TOTAL LIMIT" value={formatBytes(selectedDevice.driveLimit)} />
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 8, background: 'rgba(255,255,255,.1)', borderRadius: 4, overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, (selectedDevice.driveUsage / selectedDevice.driveLimit) * 100)}%`,
                        background: (selectedDevice.driveUsage / selectedDevice.driveLimit) > 0.9
                          ? '#ef4444'
                          : (selectedDevice.driveUsage / selectedDevice.driveLimit) > 0.75
                          ? '#facc15'
                          : '#4ade80',
                        transition: 'width .3s',
                      }}
                    />
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
                    {((selectedDevice.driveUsage / selectedDevice.driveLimit) * 100).toFixed(1)}% used
                  </p>
                </>
              ) : (
                <p style={{ color: 'rgba(255,255,255,.5)', fontSize: 13, margin: 0 }}>
                  Drive tidak terhubung — quota tidak tersedia.
                </p>
              )}
            </div>

            {/* Drive & Upload */}
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 10px', fontSize: 12, letterSpacing: '.1em', color: 'rgba(255,255,255,.5)' }}>
                GOOGLE DRIVE & UPLOAD (DEVICE INI)
              </h4>
              <div className="op-grid" style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
                <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: 16 }}>
                  <h5 style={{ margin: '0 0 12px', fontSize: 12, letterSpacing: '.1em', color: 'rgba(255,255,255,.5)' }}>
                    DRIVE STATUS
                  </h5>
                  <div className="info-row" style={{ marginBottom: 6 }}>
                    <span>Status:</span>
                    <span style={{ color: selectedDevice.driveConnected ? '#4ade80' : '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {selectedDevice.driveConnected ? <><CheckCircle2 size={12} /> Connected</> : <><AlertCircle size={12} /> Not connected</>}
                    </span>
                  </div>
                  <div className="info-row" style={{ marginBottom: 6 }}>
                    <span>Account:</span>
                    <span>{selectedDevice.driveAccount || '—'}</span>
                  </div>
                  <div className="info-row">
                    <span>Token:</span>
                    <span style={{
                      color: selectedDevice.driveTokenExpiresAt > Date.now() ? '#4ade80' : '#ef4444',
                      display: 'flex', alignItems: 'center', gap: 4
                    }}>
                      <Key size={12} /> {formatTokenExpiry(selectedDevice.driveTokenExpiresAt ?? 0)}
                    </span>
                  </div>
                </div>

                <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: 16 }}>
                  <h5 style={{ margin: '0 0 12px', fontSize: 12, letterSpacing: '.1em', color: 'rgba(255,255,255,.5)' }}>
                    UPLOAD STATUS
                  </h5>
                  <div className="info-row" style={{ marginBottom: 6 }}>
                    <span>Uploaded:</span>
                    <span style={{ color: '#4ade80' }}>{selectedDevice.uploadedCount ?? 0}</span>
                  </div>
                  <div className="info-row" style={{ marginBottom: 6 }}>
                    <span>Pending:</span>
                    <span style={{ color: '#facc15' }}>{selectedDevice.pendingCount ?? 0}</span>
                  </div>
                  <div className="info-row">
                    <span>Failed:</span>
                    <span style={{ color: '#ef4444' }}>{selectedDevice.failedCount ?? 0}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Durasi Event */}
            {selectedDevice.eventOpenedAt > 0 ? (
              <div style={{ marginBottom: 16, border: '1px solid rgba(255,255,255,.1)', padding: 16 }}>
                <h4 style={{ margin: '0 0 10px', fontSize: 12, letterSpacing: '.1em', color: 'rgba(255,255,255,.5)' }}>
                  DURASI EVENT TERBUKA
                </h4>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#ffd94e' }}>
                  {formatDuration(Date.now() - selectedDevice.eventOpenedAt)}
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 12, color: 'rgba(255,255,255,.5)' }}>
                  Dibuka: {new Date(selectedDevice.eventOpenedAt).toLocaleTimeString()}
                </p>
              </div>
            ) : null}

            {/* Quick Actions */}
            <div style={{ marginTop: 20 }}>
              <h4 style={{ margin: '0 0 12px', fontSize: 12, letterSpacing: '.1em', color: '#ffd94e' }}>
                ⚡ QUICK ACTIONS → {selectedDevice.browser} ({selectedDevice.os})
              </h4>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <ActionButton
                  icon={<Maximize2 size={16} />}
                  label="FORCE FULLSCREEN"
                  onClick={() => handleCommand('force-fullscreen', 'Force Fullscreen')}
                  color="#9333ea"
                />
                <ActionButton
                  icon={<Plug size={16} />}
                  label="RECONNECT DRIVE"
                  onClick={() => handleCommand('reconnect-drive', 'Reconnect Drive')}
                  color="#2563eb"
                />
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
            </div>
          </section>
        ) : null}

        {/* ============ STATISTIK AGREGAT ============ */}
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
      </main>
    </>
  );
};

/* ---------- SUB COMPONENTS ---------- */
const InfoCard = ({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color?: string }) => (
  <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
      <span style={{ color: 'rgba(255,255,255,.5)' }}>{icon}</span>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', letterSpacing: '.06em' }}>{label}</span>
    </div>
    <strong style={{ fontSize: 14, color: color || '#fff', wordBreak: 'break-word' }}>{value}</strong>
  </div>
);

const StatCard = ({ label, value, color }: { label: string; value: string; color: string }) => (
  <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ fontSize: 11, letterSpacing: '.1em', color: 'rgba(255,255,255,.5)' }}>{label.toUpperCase()}</span>
    <span style={{ fontSize: 22, fontWeight: 700, color }}>{value}</span>
  </div>
);

const ActionButton = ({ icon, label, onClick, disabled, color }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; color: string }) => (
  <button onClick={onClick} disabled={disabled} type="button" style={{ padding: '10px 16px', background: disabled ? '#555' : color, color: '#fff', border: 'none', fontWeight: 600, fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: disabled ? 0.5 : 1 }}>
    {icon} {label}
  </button>
);