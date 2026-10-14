import { Camera } from '@capacitor/camera';
import { App as CapApp } from '@capacitor/app';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, X, Image as ImageIcon, Plus, Check, AlertCircle, Cloud, CloudOff, FolderOpen, RefreshCw } from 'lucide-react';
import { EventFile } from './EventFile';
import { EventLoader } from './EventLoader';
import { createEmptyEvent, deleteEvent, getAllEvents, saveEvent as saveEventLocal, type R3aEvent } from './eventStore';
import { syncCloudToLocal, type SyncResult, type CloudEvent } from './cloudEventSync';
import { enumerateCameras, type CameraDevice } from './cameraStore';
import { CameraTestModal, CameraStatusBadge } from './cameraUi';
import { useCamera } from './useCamera';
import { PhotoboothSession } from './PhotoboothSession';
import { loadAllSettings, saveAllSettings, type AllSettings } from './settingsStore';
import { OperatorDashboard } from './operator/OperatorDashboard';
import { startAutoRefresh, stopAutoRefresh } from './pkceAuth';
import { ReminderPopup } from './ReminderPopup';
import { ScreensaverSlideshow } from './ScreensaverSlideshow';
import { loadAppVersion, saveAppVersion, AVAILABLE_VERSIONS, type AppVersion } from './versionStore';
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  testGoogleDriveConnection,
  testGoogleDriveUpload,
  pickDriveFolder,
  getValidToken,
  getTokenStatus,
  getPrinters,
  testPrinter,
  runDiagnostics,
} from './gdriveService';

const VITE_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || '';

type Screen = 'home' | 'project-list' | 'new-event' | 'event-file' | 'photobooth-session' | 'settings';

/* ---------- RESERVED PATHS (bukan slug event) ---------- */
const RESERVED_PATHS = new Set([
  '',
  'operator',
  'settings',
  'home',
  'project',
]);

function statusToAccent(status: string): string {
  if (status === 'Active') return '#44a96f';
  if (status === 'Ended') return '#837a73';
  return '#f56a2d';
}

function parseFolderId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const m1 = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return '';
}

/* ============================================================
   HELPER: extract slug dari URL path
   ============================================================ */
function getSlugFromUrl(): string {
  if (typeof window === 'undefined') return '';
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  return path;
}

/* ============================================================
   HELPER: detect native platform (APK)
   ============================================================ */
function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  return !!w.Capacitor?.isNativePlatform?.();
}

const WithReminder = ({
  visible,
  minutes,
  refreshing,
  onRefresh,
  onDismiss,
  needsFullscreen,
  onGoFullscreen,
  screensaverVisible,
  slideDurationSec,
  onScreensaverDismiss,
  children,
}: {
  visible: boolean;
  minutes: number;
  refreshing: boolean;
  onRefresh: () => void;
  onDismiss: () => void;
  needsFullscreen: boolean;
  onGoFullscreen: () => void;
  screensaverVisible: boolean;
  slideDurationSec: number;
  onScreensaverDismiss: () => void;
  children: React.ReactNode;
}) => (
  <>
    {children}
    {screensaverVisible ? (
      <ScreensaverSlideshow
        slideDurationSec={slideDurationSec}
        onDismiss={onScreensaverDismiss}
      />
    ) : null}
    {visible ? (
      <ReminderPopup
        minutesUntilExpiry={minutes}
        hasRefreshToken={false}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onDismiss={onDismiss}
        needsFullscreen={needsFullscreen}
        onGoFullscreen={onGoFullscreen}
      />
    ) : null}
  </>
);

/* ---------- SYNC BUTTON COMPONENT ---------- */
const SyncButton = ({
  onSync,
  syncing,
  message,
}: {
  onSync: () => void;
  syncing: boolean;
  message: string | null;
}) => (
  <div
    style={{
      position: 'absolute',
      top: 68,
      right: '6%',
      display: 'flex',
      gap: 10,
      alignItems: 'center',
      zIndex: 10,
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
      maxWidth: '40%',
    }}
  >
    <button
      onClick={onSync}
      disabled={syncing}
      type="button"
      style={{
        padding: '10px 18px',
        background: syncing ? 'rgba(255,255,255,.2)' : '#4ade80',
        color: syncing ? '#fff' : '#000',
        border: 'none',
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: '.06em',
        cursor: syncing ? 'wait' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxShadow: '0 4px 0 rgba(0,0,0,.15)',
        transition: '.18s',
      }}
    >
      <RefreshCw
        size={14}
        style={syncing ? { animation: 'spin 1s linear infinite' } : undefined}
      />
      {syncing ? 'SYNCING...' : 'SYNC FROM CLOUD'}
    </button>

    {message ? (
      <span
        style={{
          color: '#fff',
          fontSize: 11,
          fontWeight: 600,
          padding: '6px 12px',
          background: 'rgba(0,0,0,.5)',
          border: '1px solid rgba(255,255,255,.25)',
          maxWidth: '100%',
        }}
      >
        {message}
      </span>
    ) : null}

    <style>{`
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `}</style>
  </div>
);

const ProjectList = ({
  events,
  onHome,
  onOpen,
  onNew,
  onEditEvent,
  onSyncFromCloud,
  syncing,
  syncMessage,
}: {
  events: R3aEvent[];
  onHome: () => void;
  onOpen: (event: R3aEvent) => void;
  onNew: () => void;
  onEditEvent: (event: R3aEvent) => void;
  onSyncFromCloud: () => void;
  syncing: boolean;
  syncMessage: string | null;
}) => {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (activeIndex >= events.length) setActiveIndex(0);
  }, [events.length, activeIndex]);

  const moveProject = (direction: number) =>
    setActiveIndex((activeIndex + direction + events.length) % Math.max(events.length, 1));
  const event = events[activeIndex];

  if (events.length === 0) {
    return (
      <main className="project-list-screen">
        <div className="project-grain" aria-hidden="true" />
        <div className="project-rays" aria-hidden="true"><i /><i /><i /></div>
        <header className="project-heading"><p>R3A BOOTH</p><h1>PROJECT</h1><span /></header>
        <SyncButton onSync={onSyncFromCloud} syncing={syncing} message={syncMessage} />
        <section className="project-card-wrap">
          <div className="project-card" style={{ '--project-accent': '#f56a2d' } as CSSProperties}>
            <div className="project-preview">
              <div className="preview-topbar"><span>R3A</span><span>BOOTH</span></div>
              <div className="preview-copy"><small>EVENT PHOTO EXPERIENCE</small><strong>No Events Yet</strong><em>Create your first event to get started</em></div>
              <div className="preview-spark preview-spark-one" /><div className="preview-spark preview-spark-two" />
              <div className="preview-lines"><i /><i /><i /></div>
            </div>
            <div className="project-info">
              <div><span className="project-label">PROJECT 00 / 00</span><h2>No Events</h2><p>Create a new event to begin</p></div>
              <div className="project-status"><span className="status-dot status-draft" />Empty</div>
            </div>
          </div>
        </section>
        <div className="project-actions">
          <button className="project-home-button" onClick={onHome} type="button">HOME</button>
          <button className="new-project-button" onClick={onNew} type="button">NEW EVENT <span>+</span></button>
        </div>
      </main>
    );
  }

  return (
    <main className="project-list-screen">
      <div className="project-grain" aria-hidden="true" />
      <div className="project-rays" aria-hidden="true"><i /><i /><i /></div>
      <header className="project-heading"><p>R3A BOOTH</p><h1>PROJECT</h1><span /></header>
      <SyncButton onSync={onSyncFromCloud} syncing={syncing} message={syncMessage} />
      <button className="project-arrow project-arrow-left" aria-label="Previous project" onClick={() => moveProject(-1)} type="button"><ChevronLeft size={62} strokeWidth={1.5} /></button>
      <section className="project-card-wrap">
        <div className="project-card" style={{ '--project-accent': statusToAccent(event.eventStatus) } as CSSProperties}>
          <div className="project-preview">
            <div className="preview-topbar"><span>R3A</span><span>BOOTH</span></div>
            <div className="preview-copy">
              <small>EVENT PHOTO EXPERIENCE</small>
              <strong>{event.eventName || 'Untitled Event'}</strong>
              <em>{event.date || 'No date set'}{event.slug ? ` • /${event.slug}` : ''}</em>
            </div>
            <div className="preview-spark preview-spark-one" /><div className="preview-spark preview-spark-two" />
            <div className="preview-lines"><i /><i /><i /></div>
          </div>
          <div className="project-info">
            <div>
              <span className="project-label">EVENT {String(activeIndex + 1).padStart(2, '0')} / {String(events.length).padStart(2, '0')}</span>
              <h2>{event.eventName || 'Untitled Event'}</h2>
              <p>{event.date || 'No date set'}</p>
            </div>
            <div className="project-status"><span className={`status-dot status-${event.eventStatus === 'Active' ? 'ready' : 'draft'}`} />{event.eventStatus}</div>
            <button className="open-project" onClick={() => onOpen(event)} type="button">OPEN EVENT <ChevronRight size={22} /></button>
            <div className="project-card-actions">
              <button onClick={() => onEditEvent(event)} type="button">EDIT EVENT</button>
              <button onClick={async () => { await deleteEvent(event.id); window.location.reload(); }} type="button">DELETE</button>
            </div>
          </div>
        </div>
      </section>
      <button className="project-arrow project-arrow-right" aria-label="Next project" onClick={() => moveProject(1)} type="button"><ChevronRight size={62} strokeWidth={1.5} /></button>
      <div className="project-actions">
        <button className="project-home-button" onClick={onHome} type="button">HOME</button>
        <button className="new-project-button" onClick={onNew} type="button">NEW EVENT <span>+</span></button>
      </div>
      <div className="project-dots" aria-label="Project position">
        {events.map((item, index) => (
          <button key={item.id} className={index === activeIndex ? 'project-dot is-active' : 'project-dot'} aria-label={`Show ${item.eventName}`} onClick={() => setActiveIndex(index)} type="button" />
        ))}
      </div>
    </main>
  );
};

type SettingsTab = 'camera' | 'storage' | 'application' | 'display' | 'security' | 'system';

type TestState = { status: 'idle' | 'running' | 'success' | 'error'; message: string };

const Settings = ({
  onHome,
  appVersion,
  onVersionChange,
}: {
  onHome: () => void;
  appVersion: AppVersion;
  onVersionChange: (v: AppVersion) => void;
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('camera');
  const [settings, setSettings] = useState<AllSettings>(() => loadAllSettings());
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [printers, setPrinters] = useState<string[]>([]);
  const [showTest, setShowTest] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const [testCamera, setTestCamera] = useState<TestState>({ status: 'idle', message: '' });
  const [testPrinterState, setTestPrinterState] = useState<TestState>({ status: 'idle', message: '' });
  const [gdriveConnecting, setGdriveConnecting] = useState(false);
  const [gdriveTestState, setGdriveTestState] = useState<TestState>({ status: 'idle', message: '' });
  const [gdriveUploadTestState, setGdriveUploadTestState] = useState<TestState>({ status: 'idle', message: '' });
  const [gdrivePicking, setGdrivePicking] = useState(false);
  const [diagResults, setDiagResults] = useState<{ label: string; status: string; healthy: boolean }[]>([]);
  const [diagRunning, setDiagRunning] = useState(false);

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'camera', label: 'CAMERA & HARDWARE' },
    { id: 'storage', label: 'STORAGE & UPLOAD' },
    { id: 'application', label: 'APPLICATION' },
    { id: 'display', label: 'DISPLAY & INTERFACE' },
    { id: 'security', label: 'SECURITY & ADMIN' },
    { id: 'system', label: 'SYSTEM & DIAGNOSTICS' },
  ];

  useEffect(() => { void enumerateCameras().then(setCameras); }, []);
  useEffect(() => {
    const refresh = () => { void enumerateCameras().then(setCameras); };
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
  }, []);
  useEffect(() => { void getPrinters().then(setPrinters); }, []);
  const cameraHook = useCamera(settings.camera, settings.camera.cameraOn && activeTab === 'camera');

  const update = (section: keyof AllSettings, updates: Record<string, unknown>) => {
    setSettings((prev) => ({ ...prev, [section]: { ...prev[section], ...updates } }));
  };

  const updateCam = (updates: Partial<typeof settings.camera>) => update('camera', updates);

  const selectedCamera = cameras.find((c) => c.deviceId === settings.camera.selectedDeviceId);
  const cameraLabel = selectedCamera?.label || (cameras.length > 0 ? cameras[0].label : 'No camera detected');

  const handleSave = () => {
    saveAllSettings(settings);
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 2000);
  };

  const handleTestPrinter = async () => {
    setTestPrinterState({ status: 'running', message: 'Testing...' });
    const result = await testPrinter(settings.printer.printer);
    setTestPrinterState({ status: result.success ? 'success' : 'error', message: result.message });
  };

  const handleConnectGdrive = async () => {
    const clientId = VITE_CLIENT_ID;
    if (!clientId || clientId.trim().length < 10) {
      setGdriveTestState({ status: 'error', message: 'Google Client ID not configured. Contact admin.' });
      return;
    }
    setGdriveConnecting(true);
    setGdriveTestState({ status: 'idle', message: '' });
    const result = await connectGoogleDrive(clientId);
    setGdriveConnecting(false);
    if (result.success) {
      const next = { ...settings, googleDrive: { ...settings.googleDrive, connected: true, account: result.account || 'Connected' } };
      setSettings(next);
      saveAllSettings(next);
    } else {
      setGdriveTestState({ status: 'error', message: result.error || 'Connection failed' });
    }
  };

  const handleDisconnectGdrive = async () => {
    await disconnectGoogleDrive();
    const next = { ...settings, googleDrive: { ...settings.googleDrive, connected: false, account: '', mainFolderId: '', mainFolderName: '', autoUpload: false } };
    setSettings(next);
    saveAllSettings(next);
    setGdriveTestState({ status: 'idle', message: '' });
    setGdriveUploadTestState({ status: 'idle', message: '' });
  };

  const handleReconnectGdrive = async () => {
    const clientId = VITE_CLIENT_ID;
    if (!clientId) {
      setGdriveTestState({ status: 'error', message: 'Google Client ID not configured. Contact admin.' });
      return;
    }
    setGdriveConnecting(true);
    setGdriveTestState({ status: 'idle', message: '' });
    const result = await connectGoogleDrive(clientId);
    setGdriveConnecting(false);
    if (result.success) {
      const next = { ...settings, googleDrive: { ...settings.googleDrive, connected: true, account: result.account || 'Connected' } };
      setSettings(next);
      saveAllSettings(next);
    } else {
      setGdriveTestState({ status: 'error', message: result.error || 'Reconnect failed' });
    }
  };

  const handleChangeFolder = async () => {
    const clientId = VITE_CLIENT_ID;
    if (!clientId) {
      setGdriveTestState({ status: 'error', message: 'Google Client ID not configured. Contact admin.' });
      return;
    }
    setGdrivePicking(true);
    setGdriveTestState({ status: 'idle', message: '' });
    try {
      const folder = await pickDriveFolder(clientId);
      if (folder) {
        const next = { ...settings, googleDrive: { ...settings.googleDrive, mainFolderId: folder.id, mainFolderName: folder.name } };
        setSettings(next);
        saveAllSettings(next);
      }
    } catch (err) {
      setGdriveTestState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to open folder picker' });
    }
    setGdrivePicking(false);
  };

  const handleApplyManualFolder = async () => {
    const raw = settings.googleDrive.manualFolderInput;
    const folderId = parseFolderId(raw);
    if (!folderId) {
      setGdriveTestState({ status: 'error', message: 'Invalid folder URL or ID. Paste a Google Drive folder link.' });
      return;
    }
    const clientId = VITE_CLIENT_ID;
    if (!clientId) {
      setGdriveTestState({ status: 'error', message: 'Connect Google Drive first.' });
      return;
    }
    setGdrivePicking(true);
    setGdriveTestState({ status: 'running', message: 'Checking folder...' });
    try {
      const token = await getValidToken(clientId);
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Folder not found (HTTP ${res.status})`);
      }
      const data = await res.json() as { id: string; name: string; mimeType: string };
      if (data.mimeType !== 'application/vnd.google-apps.folder') {
        throw new Error('That ID is not a folder.');
      }
      const next = { ...settings, googleDrive: { ...settings.googleDrive, mainFolderId: data.id, mainFolderName: data.name } };
      setSettings(next);
      saveAllSettings(next);
      setGdriveTestState({ status: 'success', message: `Folder set: ${data.name}` });
    } catch (err) {
      setGdriveTestState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to set folder' });
    }
    setGdrivePicking(false);
  };

  const handleTestGdrive = async () => {
    setGdriveTestState({ status: 'running', message: 'Testing...' });
    const result = await testGoogleDriveConnection(VITE_CLIENT_ID);
    setGdriveTestState({ status: result.success ? 'success' : 'error', message: result.message });
  };

  const handleTestGdriveUpload = async () => {
    setGdriveUploadTestState({ status: 'running', message: 'Uploading test file...' });
    const result = await testGoogleDriveUpload(VITE_CLIENT_ID);
    setGdriveUploadTestState({ status: result.success ? 'success' : 'error', message: result.message });
  };

  const handleRunDiagnostics = async () => {
    setDiagRunning(true);
    const results = await runDiagnostics();
    setDiagResults(results);
    setDiagRunning(false);
  };

  useEffect(() => {
    document.documentElement.style.setProperty('--r3a-brightness', `${settings.display.brightness}%`);
  }, [settings.display.brightness]);

  return (
    <main className="settings-screen">
      <div className="settings-grain" aria-hidden="true" /><div className="settings-decoration settings-decoration-top" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div><div className="settings-decoration settings-decoration-bottom" aria-hidden="true"><i /><i /><i /><i /></div>
      <header className="settings-header"><p>R3A BOOTH</p><h1>SETTINGS</h1><span /></header>
      <nav className="settings-tabs" aria-label="Settings sections">{tabs.map((tab) => <button className={activeTab === tab.id ? 'settings-tab is-active' : 'settings-tab'} key={tab.id} onClick={() => setActiveTab(tab.id)} type="button">{tab.label}</button>)}</nav>
      <section className="settings-content">
        {activeTab === 'camera' ? (
          <div className="camera-settings-layout">
            <div className="settings-column">
              <div className="settings-power">
                <span>CAMERA</span>
                <button className={`settings-switch ${settings.camera.cameraOn ? 'on' : ''}`} type="button" onClick={() => updateCam({ cameraOn: !settings.camera.cameraOn })}>{settings.camera.cameraOn ? 'ON' : 'OFF'}</button>
              </div>
              <div className="setting-control">
                <span>CAMERA SOURCE</span>
                <select className="camera-source-select" value={settings.camera.selectedDeviceId || (cameras[0]?.deviceId ?? '')} onChange={(e) => updateCam({ selectedDeviceId: e.target.value })}>
                  {cameras.length === 0 ? <option value="">No camera detected</option> : cameras.map((cam) => <option key={cam.deviceId} value={cam.deviceId}>{cam.label}</option>)}
                </select>
                <em>{cameraHook.status === 'connected' ? 'CONNECTED' : cameraHook.status === 'connecting' ? 'CONNECTING' : cameraHook.status === 'error' ? 'ERROR' : 'DISCONNECTED'}</em>
              </div>
              <div className="setting-control">
                <span>CAMERA RESOLUTION</span>
                <select value={settings.camera.resolution} onChange={(e) => updateCam({ resolution: e.target.value })}>
                  <option>1280 × 720</option>
                  <option>1920 × 1080</option>
                  <option>3840 × 2160</option>
                </select>
              </div>
              <div className="setting-control">
                <span>FRAME RATE</span>
                <select value={settings.camera.frameRate} onChange={(e) => updateCam({ frameRate: e.target.value })}>
                  <option>30 FPS</option>
                  <option>60 FPS</option>
                </select>
              </div>
              <div className="setting-control">
                <span>ASPECT RATIO</span>
                <select value={settings.camera.aspectRatio} onChange={(e) => updateCam({ aspectRatio: e.target.value })}>
                  <option>16:9</option>
                  <option>4:3</option>
                  <option>1:1</option>
                  <option>9:16</option>
                </select>
              </div>
              <div className="setting-control">
                <span>ORIENTATION</span>
                <select value={settings.camera.orientation} onChange={(e) => updateCam({ orientation: e.target.value })}>
                  <option>LANDSCAPE</option>
                  <option>PORTRAIT</option>
                </select>
              </div>
              <div className="setting-control">
                <span>MIRROR PREVIEW</span>
                <button type="button" onClick={() => updateCam({ mirror: !settings.camera.mirror })}>{settings.camera.mirror ? 'ON' : 'OFF'}<b>▼</b></button>
              </div>
              <div className="setting-control">
                <span>PREVIEW QUALITY</span>
                <select value={settings.camera.previewQuality} onChange={(e) => updateCam({ previewQuality: e.target.value })}>
                  <option>HIGH</option>
                  <option>MEDIUM</option>
                  <option>LOW</option>
                </select>
              </div>
              <div className="setting-control">
                <span>LOW LATENCY MODE</span>
                <button type="button" onClick={() => updateCam({ lowLatency: !settings.camera.lowLatency })}>{settings.camera.lowLatency ? 'ON' : 'OFF'}<b>▼</b></button>
              </div>
            </div>
            <div className="settings-column printer-settings">
              <div className="settings-power">
                <span>PRINTER</span>
                <button className={`settings-switch ${settings.printer.printerOn ? 'on' : ''}`} type="button" onClick={() => update('printer', { printerOn: !settings.printer.printerOn })}>{settings.printer.printerOn ? 'ON' : 'OFF'}</button>
              </div>
              <div className="setting-control">
                <span>PRINTER</span>
                <select value={settings.printer.printer} onChange={(e) => update('printer', { printer: e.target.value })} disabled={printers.length === 0}>
                  {printers.length === 0 ? <option>No printer detected</option> : printers.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <em>{printers.length > 0 ? 'CONNECTED' : 'DISCONNECTED'}</em>
              </div>
              <div className="setting-control">
                <span>PRINTER STATUS</span>
                <button type="button">{settings.printer.printerOn ? (printers.length > 0 ? 'READY' : 'OFFLINE') : 'OFF'}<b>▼</b></button>
              </div>
              <div className="setting-control">
                <span>PAPER SIZE</span>
                <select value={settings.printer.paperSize} onChange={(e) => update('printer', { paperSize: e.target.value })}>
                  <option>4 × 6 in</option>
                  <option>5 × 7 in</option>
                  <option>A4</option>
                  <option>Letter</option>
                </select>
              </div>
              <div className="photobooth-camera-status" style={{ marginBottom: 12 }}><CameraStatusBadge status={cameraHook.status} error={cameraHook.error} /></div>
              <div className="test-buttons">
                <button type="button" onClick={() => setShowTest(true)}>TEST CAMERA</button>
                <button type="button" onClick={handleTestPrinter} disabled={testPrinterState.status === 'running'}>TEST PRINTER</button>
              </div>
              {testPrinterState.status !== 'idle' ? (
                <div className={`settings-test-result ${testPrinterState.status}`}>
                  {testPrinterState.status === 'success' ? <Check size={16} /> : testPrinterState.status === 'error' ? <AlertCircle size={16} /> : null}
                  {testPrinterState.message}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeTab === 'storage' ? (
          <div className="storage-settings-layout">
            <div className="storage-block">
              <div className="storage-heading"><span>LOCAL STORAGE</span><em>{settings.storage.autoDownloadResult ? 'AUTO DOWNLOAD' : 'MANUAL'}</em></div>
              <div className="setting-control">
                <span>FILE NAMING</span>
                <input
                  value={settings.storage.fileNaming}
                  onChange={(e) => update('storage', { fileNaming: e.target.value })}
                  placeholder="{event}_{date}_{number}"
                />
              </div>
              <div className="setting-control">
                <span>SAVE PHOTOS</span>
                <button className={`toggle-row ${settings.storage.savePhotos ? 'is-on' : ''}`} type="button" onClick={() => update('storage', { savePhotos: !settings.storage.savePhotos })}><i />{settings.storage.savePhotos ? 'ON' : 'OFF'}</button>
              </div>
              <div className="setting-control">
                <span>SAVE VIDEOS</span>
                <button className={`toggle-row ${settings.storage.saveVideos ? 'is-on' : ''}`} type="button" onClick={() => update('storage', { saveVideos: !settings.storage.saveVideos })}><i />{settings.storage.saveVideos ? 'ON' : 'OFF'}</button>
              </div>
              <div className="setting-control">
                <span>AUTO DOWNLOAD RESULT</span>
                <button className={`toggle-row ${settings.storage.autoDownloadResult ? 'is-on' : ''}`} type="button" onClick={() => update('storage', { autoDownloadResult: !settings.storage.autoDownloadResult })}><i />{settings.storage.autoDownloadResult ? 'ON' : 'OFF'}</button>
              </div>
              <div className="setting-control">
                <span>KEEP FILES</span>
                <select value={settings.storage.keepFiles} onChange={(e) => update('storage', { keepFiles: e.target.value })}>
                  <option>7 DAYS</option>
                  <option>30 DAYS</option>
                  <option>90 DAYS</option>
                  <option>FOREVER</option>
                </select>
              </div>
            </div>
            <div className="storage-block hub-block">
              <div className="storage-heading">
                <span>GOOGLE DRIVE</span>
                <em className={settings.googleDrive.connected ? '' : 'not-configured'}>
                  {settings.googleDrive.connected ? 'CONNECTED' : 'DISCONNECTED'}
                </em>
              </div>

              {!settings.googleDrive.connected ? (
                <div className="hub-message">
                  <strong>Connect to Google Drive</strong>
                  <p>Connect your Google account to select a main folder for photo storage.</p>
                  <button type="button" onClick={handleConnectGdrive} disabled={gdriveConnecting}>
                    {gdriveConnecting ? 'CONNECTING...' : 'CONNECT GOOGLE DRIVE'} <ChevronRight size={19} />
                  </button>
                  {gdriveTestState.status === 'error' ? (
                    <div className="settings-test-result error"><AlertCircle size={16} /> {gdriveTestState.message}</div>
                  ) : null}
                </div>
              ) : (
                <div className="gdrive-connected">
                  <div className="setting-control">
                    <span>CONNECTION STATUS</span>
                    <button type="button" className="gdrive-status-btn"><Cloud size={16} /> CONNECTED</button>
                  </div>
                  <div className="setting-control">
                    <span>GOOGLE ACCOUNT</span>
                    <button type="button" className="gdrive-account-btn">{settings.googleDrive.account || 'Connected'}</button>
                  </div>

                  <div className="setting-control">
                    <span>TOKEN REMINDER ({settings.googleDrive.reminderIntervalMin || 50} MIN)</span>
                    <button
                      className={`toggle-row ${settings.googleDrive.reminderEnabled ? 'is-on' : ''}`}
                      type="button"
                      onClick={() => update('googleDrive', { reminderEnabled: !settings.googleDrive.reminderEnabled })}
                    >
                      <i />{settings.googleDrive.reminderEnabled ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  <div className="setting-control">
                    <span>REMINDER INTERVAL (MIN)</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={String(settings.googleDrive.reminderIntervalMin ?? 50)}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        const num = raw === '' ? 0 : parseInt(raw, 10);
                        update('googleDrive', { reminderIntervalMin: num });
                      }}
                      onBlur={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        const num = raw === '' ? 50 : parseInt(raw, 10);
                        if (!num || num < 1 || num > 60) {
                          update('googleDrive', { reminderIntervalMin: 50 });
                        }
                      }}
                      placeholder="50"
                      style={{ padding: 8, fontSize: 14 }}
                    />
                  </div>

                  <div className="setting-control">
                    <span>MAIN FOLDER (CURRENT)</span>
                    <button type="button" className="gdrive-folder-display">
                      <FolderOpen size={16} />
                      {settings.googleDrive.mainFolderName || 'No folder selected'}
                    </button>
                  </div>

                  <div className="setting-control">
                    <span>OPTION A — PASTE FOLDER LINK / ID</span>
                    <div className="gdrive-folder-row">
                      <input
                        type="text"
                        value={settings.googleDrive.manualFolderInput}
                        onChange={(e) => update('googleDrive', { manualFolderInput: e.target.value })}
                        placeholder="https://drive.google.com/drive/folders/XXXX  or  folder ID"
                        style={{ flex: 1, padding: 8 }}
                      />
                      <button type="button" className="gdrive-change-folder" onClick={handleApplyManualFolder} disabled={gdrivePicking}>
                        {gdrivePicking ? 'CHECKING...' : 'SET FOLDER'}
                      </button>
                    </div>
                    <em style={{ fontSize: 11, opacity: 0.6 }}>
                      Buka folder di Google Drive → copy URL → paste di sini.
                    </em>
                  </div>

                  <div className="setting-control">
                    <span>OPTION B — PICK FROM DRIVE</span>
                    <div className="gdrive-folder-row">
                      <button type="button" className="gdrive-change-folder" onClick={handleChangeFolder} disabled={gdrivePicking}>
                        {gdrivePicking ? 'OPENING...' : 'OPEN PICKER'}
                      </button>
                    </div>
                  </div>

                  <div className="gdrive-actions">
                    <button type="button" onClick={handleTestGdrive} disabled={gdriveTestState.status === 'running'}>
                      {gdriveTestState.status === 'running' ? 'TESTING...' : 'TEST CONNECTION'}
                    </button>
                    <button type="button" onClick={handleReconnectGdrive} disabled={gdriveConnecting}>
                      <RefreshCw size={14} /> {gdriveConnecting ? 'CONNECTING...' : 'RECONNECT'}
                    </button>
                    <button type="button" className="gdrive-disconnect" onClick={handleDisconnectGdrive}>
                      <CloudOff size={16} /> DISCONNECT
                    </button>
                  </div>
                  {gdriveTestState.status !== 'idle' ? (
                    <div className={`settings-test-result ${gdriveTestState.status}`}>
                      {gdriveTestState.status === 'success' ? <Check size={16} /> : gdriveTestState.status === 'error' ? <AlertCircle size={16} /> : null}
                      {gdriveTestState.message}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {activeTab === 'application' ? (
          <div className="settings-simple-panel">
            <div className="simple-panel-heading"><span>APPLICATION</span><p>Global software configuration</p></div>
            <div className="simple-panel-grid">
              <div className="setting-control">
                <span>STARTUP MODE</span>
                <select value={settings.application.startupMode} onChange={(e) => update('application', { startupMode: e.target.value })}>
                  <option>HOME SCREEN</option>
                  <option>PROJECT LIST</option>
                  <option>PHOTOBOOTH</option>
                </select>
              </div>
              <div className="setting-control">
                <span>LANGUAGE</span>
                <select value={settings.application.language} onChange={(e) => update('application', { language: e.target.value })}>
                  <option>ENGLISH</option>
                  <option>BAHASA INDONESIA</option>
                </select>
              </div>
              <div className="setting-control">
                <span>CHECK FOR UPDATES</span>
                <button className={`toggle-row ${settings.application.checkUpdates ? 'is-on' : ''}`} type="button" onClick={() => update('application', { checkUpdates: !settings.application.checkUpdates })}>
                  <i />{settings.application.checkUpdates ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="setting-control">
                <span>ANALYTICS</span>
                <button className={`toggle-row ${settings.application.analytics ? 'is-on' : ''}`} type="button" onClick={() => update('application', { analytics: !settings.application.analytics })}>
                  <i />{settings.application.analytics ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === 'display' ? (
          <div className="settings-simple-panel">
            <div className="simple-panel-heading"><span>DISPLAY & INTERFACE</span><p>Screen and touch configuration</p></div>
            <div className="simple-panel-grid">
              <div className="setting-control">
                <span>DISPLAY MODE</span>
                <select value={settings.display.displayMode} onChange={(e) => update('display', { displayMode: e.target.value })}>
                  <option>FULLSCREEN</option>
                  <option>WINDOWED</option>
                  <option>KIOSK</option>
                </select>
              </div>
              <div className="setting-control">
                <span>SCREEN BRIGHTNESS</span>
                <div className="brightness-slider-wrap">
                  <input type="range" min="20" max="100" value={settings.display.brightness} onChange={(e) => update('display', { brightness: parseInt(e.target.value, 10) })} className="brightness-slider" />
                  <em>{settings.display.brightness}%</em>
                </div>
              </div>
              <div className="setting-control">
                <span>TOUCH INPUT</span>
                <button className={`toggle-row ${settings.display.touchInput ? 'is-on' : ''}`} type="button" onClick={() => update('display', { touchInput: !settings.display.touchInput })}>
                  <i />{settings.display.touchInput ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="setting-control">
                <span>IDLE SCREEN</span>
                <select value={settings.display.idleScreen} onChange={(e) => update('display', { idleScreen: e.target.value })}>
                  <option>HOME SCREEN</option>
                  <option>BLANK</option>
                  <option>LOGO</option>
                  <option>SLIDESHOW</option>
                </select>
              </div>
              <div className="setting-control">
                <span>SHOW PRINT BUTTON</span>
                <button className={`toggle-row ${settings.display.showPrintButton ? 'is-on' : ''}`} type="button" onClick={() => update('display', { showPrintButton: !settings.display.showPrintButton })}>
                  <i />{settings.display.showPrintButton ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="setting-control">
                <span>SHOW QR CODE BUTTON</span>
                <button className={`toggle-row ${settings.display.showQrButton ? 'is-on' : ''}`} type="button" onClick={() => update('display', { showQrButton: !settings.display.showQrButton })}>
                  <i />{settings.display.showQrButton ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="setting-control">
                <span>SHOW DRIVE QR BUTTON</span>
                <button className={`toggle-row ${settings.display.showDriveQrButton ? 'is-on' : ''}`} type="button" onClick={() => update('display', { showDriveQrButton: !settings.display.showDriveQrButton })}>
                  <i />{settings.display.showDriveQrButton ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="setting-control">
                <span>IDLE TIMEOUT (MIN)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={String(settings.display.idleTimeoutMin ?? 3)}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    const num = raw === '' ? 0 : parseInt(raw, 10);
                    update('display', { idleTimeoutMin: num });
                  }}
                  onBlur={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    const num = raw === '' ? 3 : parseInt(raw, 10);
                    if (!num || num < 1 || num > 120) {
                      update('display', { idleTimeoutMin: 3 });
                    }
                  }}
                  placeholder="3"
                  style={{ padding: 8, fontSize: 14 }}
                />
              </div>
              <div className="setting-control">
                <span>SLIDE DURATION (SEC)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={String(settings.display.slideDurationSec ?? 5)}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    const num = raw === '' ? 0 : parseInt(raw, 10);
                    update('display', { slideDurationSec: num });
                  }}
                  onBlur={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    const num = raw === '' ? 5 : parseInt(raw, 10);
                    if (!num || num < 1 || num > 60) {
                      update('display', { slideDurationSec: 5 });
                    }
                  }}
                  placeholder="5"
                  style={{ padding: 8, fontSize: 14 }}
                />
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === 'security' ? (
          <div className="settings-simple-panel">
            <div className="simple-panel-heading"><span>SECURITY & ADMIN</span><p>Access control and admin settings</p></div>
            <div className="simple-panel-grid">
              <div className="setting-control">
                <span>ADMIN LOCK</span>
                <button className={`toggle-row ${settings.security.adminLock ? 'is-on' : ''}`} type="button" onClick={() => update('security', { adminLock: !settings.security.adminLock })}>
                  <i />{settings.security.adminLock ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="setting-control">
                <span>ADMIN PIN</span>
                <input
                  type="password"
                  value={settings.security.adminPin}
                  onChange={(e) => update('security', { adminPin: e.target.value })}
                  placeholder={settings.security.adminPin ? '••••' : 'NOT SET'}
                />
              </div>
              <div className="setting-control">
                <span>AUTO LOCK</span>
                <select value={settings.security.autoLock} onChange={(e) => update('security', { autoLock: e.target.value })}>
                  <option>NEVER</option>
                  <option>5 MINUTES</option>
                  <option>15 MINUTES</option>
                  <option>30 MINUTES</option>
                </select>
              </div>
              <div className="setting-control">
                <span>ACCESS LEVEL</span>
                <select value={settings.security.accessLevel} onChange={(e) => update('security', { accessLevel: e.target.value })}>
                  <option>OPERATOR</option>
                  <option>ADMIN</option>
                </select>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === 'system' ? (
          <div className="settings-simple-panel">
            <div className="simple-panel-heading"><span>SYSTEM & DIAGNOSTICS</span><p>System health and diagnostics</p></div>
            <div className="simple-panel-grid">
              <div className="setting-control" style={{ alignItems: 'start' }}>
                <span>APP VERSION</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 260 }}>
                    <select
                      value={appVersion}
                      onChange={(e) => {
                        const next = e.target.value as AppVersion;
                        const info = AVAILABLE_VERSIONS.find((v) => v.id === next);
                        if (confirm(`Ganti ke ${next}?\n\n${info?.description}\n\nAplikasi akan reload.`)) {
                        onVersionChange(next);
                        setTimeout(() => window.location.reload(), 300);
                      }
                    }}
                    style={{
                      height: 50,
                      padding: '0 16px',
                      border: 0,
                      color: '#342f2d',
                      background: '#fffdf9',
                      font: 'inherit',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {AVAILABLE_VERSIONS.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label} — {v.description}
                      </option>
                    ))}
                  </select>
                  <em style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', fontStyle: 'normal' }}>
                    Versi aktif: <strong style={{ color: '#ffd94e' }}>{appVersion}</strong>
                  </em>
                </div>
              </div>
              <div className="setting-control">
                <span>IG FOLLOW GATE</span>
                <button
                  className={`toggle-row ${settings.system.igGateEnabled ? 'is-on' : ''}`}
                  type="button"
                  onClick={() => update('system', { igGateEnabled: !settings.system.igGateEnabled })}
                >
                  <i />{settings.system.igGateEnabled ? 'ON' : 'OFF'}
                </button>
                <em style={{ fontSize: 11, opacity: 0.6 }}>
                  Popup follow IG saat pilih frame (v1.0.0)
                </em>
              </div>
              <div className="setting-control">
                <span>ELECTRON STATUS</span>
                <button type="button">BROWSER MODE<b>▼</b></button>
              </div>
              <div className="setting-control">
                <span>SYSTEM STATUS</span>
                <button type="button">{diagResults.length > 0 ? (diagResults.every((d) => d.healthy) ? 'HEALTHY' : 'ATTENTION') : 'NOT CHECKED'}<b>▼</b></button>
              </div>
            </div>
            <button className="storage-test" type="button" onClick={handleRunDiagnostics} disabled={diagRunning}>
              {diagRunning ? 'RUNNING DIAGNOSTICS...' : 'RUN DIAGNOSTICS'} <ChevronRight size={19} />
            </button>
            {diagResults.length > 0 ? (
              <div className="diag-results">
                {diagResults.map((d) => (
                  <div key={d.label} className={`diag-row ${d.healthy ? 'healthy' : 'unhealthy'}`}>
                    <span>{d.label}</span>
                    <em>{d.status}</em>
                    <i className={`diag-dot ${d.healthy ? 'ok' : 'err'}`} />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
      <footer className="settings-footer">
        <button onClick={onHome} type="button">HOME</button>
        <button className="save-settings-button" type="button" onClick={handleSave}>
          {saveFlash ? 'SETTINGS SAVED' : 'SAVE SETTINGS'} <span>✓</span>
        </button>
      </footer>
      {showTest ? <CameraTestModal settings={settings.camera} onClose={() => setShowTest(false)} /> : null}
    </main>
  );
};

function App() {
  const [screen, setScreen] = useState<Screen>('home');

  useEffect(() => {
    startAutoRefresh();
    return () => stopAutoRefresh();
  }, []);

  // ⚠️ REQUEST CAMERA PERMISSION (khusus Android APK)
  useEffect(() => {
    const requestPermissions = async () => {
      try {
        const isNative = isNativePlatform();

        if (!isNative) {
          console.log('[Permissions] Web mode — skip native permission');
          return;
        }

        console.log('[Permissions] Requesting camera permission...');
        const status = await Camera.checkPermissions();
        console.log('[Permissions] Current status:', status);

        if (status.camera !== 'granted') {
          const result = await Camera.requestPermissions({ permissions: ['camera'] });
          console.log('[Permissions] After request:', result);
        } else {
          console.log('[Permissions] Camera already granted ✅');
        }
      } catch (err) {
        console.warn('[Permissions] Error:', err);
      }
    };

    void requestPermissions();
  }, []);

  // ⚠️ BACK BUTTON HANDLING (Android) — biar tidak close app langsung
  useEffect(() => {
    if (!isNativePlatform()) return;

    const listenerPromise = CapApp.addListener('backButton', () => {
      // Kalau di home → minimize app
      if (screenRef.current === 'home') {
        void CapApp.minimizeApp();
        return;
      }
      // Di screen lain → kembali ke home
      setScreen('home');
      setUrlSlug('');
      setCloudEvent(null);
      setActiveEvent(null);
      setEditingEvent(null);
      window.history.pushState({}, '', '/');
    });

    return () => {
      void listenerPromise.then((l) => l.remove());
    };
  }, []);

  // ⚠️ KEEP SCREEN AWAKE (Android) — biar layar tidak sleep
  useEffect(() => {
    if (!isNativePlatform()) return;

    void KeepAwake.keepAwake().catch(() => {});
    return () => {
      void KeepAwake.allowSleep().catch(() => {});
    };
  }, []);

  // ⚠️ FULLSCREEN saat app dibuka (Android)
  useEffect(() => {
    if (!isNativePlatform()) return;

    try {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } catch { /* ignore */ }
  }, []);

  const [events, setEvents] = useState<R3aEvent[]>([]);
  const [activeEvent, setActiveEvent] = useState<R3aEvent | null>(null);
  const [editingEvent, setEditingEvent] = useState<R3aEvent | null>(null);
  const [settings, setSettings] = useState<AllSettings>(() => loadAllSettings());
  const [appVersion, setAppVersion] = useState<AppVersion>(() => loadAppVersion());
  const [hash, setHash] = useState(() =>
    typeof window !== 'undefined' ? window.location.hash : ''
  );

  /* ============================================================
     URL SLUG STATE
     ============================================================ */
  const [urlSlug, setUrlSlug] = useState<string>(() => getSlugFromUrl());
  const [cloudEvent, setCloudEvent] = useState<CloudEvent | null>(null);
  const [cloudLoading, setCloudLoading] = useState<boolean>(false);

  /* ============================================================
     SYNC FROM CLOUD STATE
     ============================================================ */
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Ref untuk screen & phase (dibaca dari setInterval)
  const screenRef = useRef<Screen>(screen);
  useEffect(() => { screenRef.current = screen; }, [screen]);
  const photoboothPhaseRef = useRef<string>('frame-select');

  // === Reminder state ===
  const [reminderVisible, setReminderVisible] = useState(false);
  const [reminderMinutes, setReminderMinutes] = useState(0);
  const [reminderRefreshing, setReminderRefreshing] = useState(false);
  const [needsFullscreen, setNeedsFullscreen] = useState(false);
  const reminderTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastReminderAtRef = useRef<number>(Date.now());

  // === Idle screensaver state ===
  const [screensaverVisible, setScreensaverVisible] = useState(false);
  const lastActivityRef = useRef<number>(Date.now());
  const screensaverTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshEvents = async () => { setEvents(await getAllEvents()); };
  useEffect(() => { void refreshEvents(); }, []);

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash;

      // ⚠️ Kalau #operator, paksa URL ke root (buang slug event)
      if (h === '#operator' && window.location.pathname !== '/') {
        window.history.replaceState({}, '', `/#operator`);
        setUrlSlug('');
        setCloudEvent(null);
        setActiveEvent(null);
        setCloudLoading(false);
      }

      setHash(h);
    };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  /* ---------- Handle URL changes (popstate) ---------- */
  useEffect(() => {
    const onPopState = () => {
      const slug = getSlugFromUrl();
      setUrlSlug(slug);
      if (!slug) {
        setCloudEvent(null);
        setCloudLoading(false);
        setActiveEvent(null);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  /* ---------- Trigger cloud load kalau urlSlug bukan reserved ---------- */
  useEffect(() => {
    const slug = urlSlug;
    if (!slug) return;
    if (RESERVED_PATHS.has(slug)) return;
    if (cloudEvent || cloudLoading) return;
    // Kalau activeEvent ada DAN slug cocok → tidak perlu load dari cloud
    if (activeEvent && activeEvent.slug === slug) return;

    setCloudLoading(true);
  }, [urlSlug, cloudEvent, cloudLoading, activeEvent]);

  /* ---------- HANDLE SYNC FROM CLOUD ---------- */
  const handleSyncFromCloud = async () => {
    setSyncing(true);
    setSyncMessage(null);

    try {
      const result: SyncResult = await syncCloudToLocal(saveEventLocal, getAllEvents);

      await refreshEvents();

      if (result.errors.length > 0) {
        setSyncMessage(`⚠️ ${result.added} baru, ${result.updated} update, ${result.errors.length} error`);
      } else if (result.total === 0) {
        setSyncMessage(`Tidak ada event di cloud`);
      } else {
        setSyncMessage(`✅ ${result.added} baru, ${result.updated} update, ${result.skipped} skip`);
      }
    } catch (err) {
      setSyncMessage(`❌ Sync gagal: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMessage(null), 5000);
    }
  };

  // === Reminder timer ===
  useEffect(() => {
    if (reminderTimerRef.current) {
      clearInterval(reminderTimerRef.current);
      reminderTimerRef.current = null;
    }

    const gd = settings.googleDrive;
    if (!gd.reminderEnabled || !gd.connected || !VITE_CLIENT_ID) {
      setReminderVisible(false);
      return;
    }

    const rawInterval = Number(gd.reminderIntervalMin);
    const intervalMin =
      Number.isFinite(rawInterval) && rawInterval >= 1 && rawInterval <= 60
        ? rawInterval
        : 50;
    const intervalMs = intervalMin * 60 * 1000;

    lastReminderAtRef.current = Date.now();

    reminderTimerRef.current = setInterval(() => {
      const now = Date.now();
      if (now - lastReminderAtRef.current < intervalMs) return;

      const status = getTokenStatus();
      const msLeft = status.hasToken && status.expiresAt ? status.expiresAt - now : 0;
      const minutesLeft = Math.max(0, Math.floor(msLeft / 60000));

      setReminderMinutes(minutesLeft);
      setReminderVisible(true);
      setNeedsFullscreen(false);
      lastReminderAtRef.current = now;
    }, 5 * 1000);
  }, [settings.googleDrive.reminderEnabled, settings.googleDrive.connected, settings.googleDrive.reminderIntervalMin]);

  // === Idle screensaver timer ===
  useEffect(() => {
    if (screensaverTimerRef.current) {
      clearInterval(screensaverTimerRef.current);
      screensaverTimerRef.current = null;
    }

    const timeoutMin = Number(settings.display.idleTimeoutMin);
    const timeoutMs =
      Number.isFinite(timeoutMin) && timeoutMin >= 1 && timeoutMin <= 120
        ? timeoutMin * 60 * 1000
        : 3 * 60 * 1000;

    const bumpActivity = () => {
      lastActivityRef.current = Date.now();
      setScreensaverVisible(false);
    };

    window.addEventListener('mousemove', bumpActivity);
    window.addEventListener('click', bumpActivity);
    window.addEventListener('touchstart', bumpActivity);
    window.addEventListener('keydown', bumpActivity);

    lastActivityRef.current = Date.now();

    screensaverTimerRef.current = setInterval(() => {
      const now = Date.now();
      if (now - lastActivityRef.current < timeoutMs) return;
      if (typeof window !== 'undefined' && window.location.hash === '#operator') return;

      if (screenRef.current === 'photobooth-session') {
        if (photoboothPhaseRef.current !== 'frame-select') return;
      }

      setScreensaverVisible(true);
    }, 5 * 1000);

    return () => {
      window.removeEventListener('mousemove', bumpActivity);
      window.removeEventListener('click', bumpActivity);
      window.removeEventListener('touchstart', bumpActivity);
      window.removeEventListener('keydown', bumpActivity);
      if (screensaverTimerRef.current) clearInterval(screensaverTimerRef.current);
    };
  }, [settings.display.idleTimeoutMin]);

  const handleReminderRefresh = async () => {
    const clientId = VITE_CLIENT_ID;
    if (!clientId) {
      setReminderVisible(false);
      return;
    }
    setReminderRefreshing(true);
    try {
      const result = await connectGoogleDrive(clientId);
      if (result.success) {
        const next = { ...settings, googleDrive: { ...settings.googleDrive, connected: true, account: result.account || 'Connected' } };
        setSettings(next);
        saveAllSettings(next);
        lastReminderAtRef.current = Date.now();
        setNeedsFullscreen(true);
      }
    } catch { /* ignore */ }
    setReminderRefreshing(false);
  };

  const handleGoFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.();
      }
    } catch { /* ignore */ }
    setNeedsFullscreen(false);
    setReminderVisible(false);
  };

  const reminderProps = {
    visible: reminderVisible,
    minutes: reminderMinutes,
    refreshing: reminderRefreshing,
    onRefresh: handleReminderRefresh,
    onDismiss: () => setReminderVisible(false),
    needsFullscreen,
    onGoFullscreen: handleGoFullscreen,
    screensaverVisible,
    slideDurationSec: settings.display.slideDurationSec || 5,
    onScreensaverDismiss: () => {
      lastActivityRef.current = Date.now();
      setScreensaverVisible(false);
    },
  };

  /* ============================================================
     ROUTING PRIORITY
     ============================================================ */

  // Priority 1: Operator via hash
  if (hash === '#operator') {
    return (
      <OperatorDashboard
        allSettings={settings}
        onClose={() => {
          // ⚠️ Reset total ke home
          window.history.pushState({}, '', '/');
          setUrlSlug('');
          setCloudEvent(null);
          setCloudLoading(false);
          setActiveEvent(null);
          setScreen('home');
          setHash('');
        }}
      />
    );
  }

  // Priority 2: Event via URL slug
  if (urlSlug && !RESERVED_PATHS.has(urlSlug)) {
    // ✅ Kalau activeEvent ada DAN slug cocok → pakai LOKAL (frame lengkap)
    if (activeEvent && activeEvent.slug === urlSlug) {
      return (
        <WithReminder {...reminderProps}>
          <PhotoboothSession
            event={activeEvent}
            cameraSettings={settings.camera}
            allSettings={settings}
            onExit={() => {
              window.history.pushState({}, '', '/');
              setUrlSlug('');
              setActiveEvent(null);
              setScreen('project-list');
            }}
            onPhaseChange={(phase) => { photoboothPhaseRef.current = phase; }}
          />
        </WithReminder>
      );
    }

    // Kalau cloudEvent ada → pakai (untuk guest buka URL langsung)
    if (cloudEvent) {
      return (
        <WithReminder {...reminderProps}>
          <PhotoboothSession
            event={cloudEvent}
            cameraSettings={settings.camera}
            allSettings={settings}
            onExit={() => {
              window.history.pushState({}, '', '/');
              setUrlSlug('');
              setCloudEvent(null);
              setCloudLoading(false);
              setScreen('home');
            }}
            onPhaseChange={(phase) => { photoboothPhaseRef.current = phase; }}
          />
        </WithReminder>
      );
    }

    // Belum load → tampilkan EventLoader
    return (
      <WithReminder {...reminderProps}>
        <EventLoader
          slug={urlSlug}
          onLoad={(event) => {
            setCloudEvent(event);
            setCloudLoading(false);
          }}
          onNotFound={() => {
            window.history.pushState({}, '', '/');
            setUrlSlug('');
            setCloudLoading(false);
          }}
        />
      </WithReminder>
    );
  }

  if (screen === 'project-list') {
    return (
      <WithReminder {...reminderProps}>
        <ProjectList
          events={events}
          onHome={() => setScreen('home')}
          onOpen={(event) => {
            // ✅ Push URL ke /[slug] kalau event punya slug
            if (event.slug) {
              window.history.pushState({}, '', `/${event.slug}`);
              setUrlSlug(event.slug);
            }
            setActiveEvent(event);
            setScreen('photobooth-session');
          }}
          onNew={() => { setEditingEvent(createEmptyEvent()); setScreen('event-file'); }}
          onEditEvent={(event) => { setEditingEvent(event); setScreen('event-file'); }}
          onSyncFromCloud={handleSyncFromCloud}
          syncing={syncing}
          syncMessage={syncMessage}
        />
      </WithReminder>
    );
  }

  if (screen === 'event-file' && editingEvent) {
    return (
      <WithReminder {...reminderProps}>
        <EventFile event={editingEvent} onSaved={async (saved) => { await refreshEvents(); setEditingEvent(saved); setScreen('project-list'); }} onHome={() => setScreen('project-list')} />
      </WithReminder>
    );
  }

  if (screen === 'photobooth-session' && activeEvent && !urlSlug) {
    return (
      <WithReminder {...reminderProps}>
        <PhotoboothSession
          event={activeEvent}
          cameraSettings={settings.camera}
          allSettings={settings}
          onExit={() => { setActiveEvent(null); setScreen('project-list'); }}
          onPhaseChange={(phase) => { photoboothPhaseRef.current = phase; }}
        />
      </WithReminder>
    );
  }

  if (screen === 'photobooth-session' && !activeEvent) {
    return (
      <WithReminder {...reminderProps}>
        <main className="photobooth-screen photobooth-kiosk" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <AlertCircle size={48} strokeWidth={1} />
          <h2 style={{ fontSize: 24, margin: 0 }}>Event not found</h2>
          <p style={{ color: 'rgba(255,255,255,.5)', margin: 0 }}>The event data is missing or malformed.</p>
          <button onClick={() => setScreen('project-list')} type="button" style={{ marginTop: 8, padding: '10px 24px', background: '#ef3f25', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }}>BACK</button>
        </main>
      </WithReminder>
    );
  }

  if (screen === 'settings') {
    return (
      <WithReminder {...reminderProps}>
        <Settings
          onHome={() => { setSettings(loadAllSettings()); setScreen('home'); }}
          appVersion={appVersion}
          onVersionChange={(v) => { saveAppVersion(v); setAppVersion(v); }}
        />
      </WithReminder>
    );
  }

  return (
    <WithReminder {...reminderProps}>
      <main className="home-screen">
        <div className="grain" aria-hidden="true" />
        <div className="corner-shape corner-shape-left" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="corner-shape corner-shape-right" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="pattern pattern-top" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></div>
        <div className="pattern pattern-bottom" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></div>
        <button className="fullscreen-button" type="button" title="Toggle fullscreen" onClick={() => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); }}><Maximize2 size={19} /></button>
        <section className="home-content">
          <div className="brand-lockup"><span className="brand-r3a">R3A</span><span className="brand-booth">BOOTH</span></div>
          <p className="home-kicker">EVENT PHOTO EXPERIENCE</p>
          <div className="home-actions">
            <button className="primary-button" onClick={() => setScreen('project-list')} type="button"><span>PROJECT</span><ChevronRight size={26} /></button>
            <button className="primary-button" onClick={() => setScreen('settings')} type="button"><span>SETTINGS</span><ChevronRight size={26} /></button>
          </div>
        </section>
        <div className="home-footer"><span>R3A BOOTH</span><span>READY TO CREATE</span></div>
      </main>
    </WithReminder>
  );
}

export default App;