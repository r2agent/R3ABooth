import { useEffect, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, X, Image as ImageIcon, Plus, Check, AlertCircle, Cloud, CloudOff, FolderOpen, RefreshCw } from 'lucide-react';
import { EventFile } from './EventFile';
import { createEmptyEvent, deleteEvent, getAllEvents, type R3aEvent } from './eventStore';
import { enumerateCameras, type CameraDevice } from './cameraStore';
import { CameraTestModal, CameraStatusBadge } from './cameraUi';
import { useCamera } from './useCamera';
import { PhotoboothSession } from './PhotoboothSession';
import { loadAllSettings, saveAllSettings, type AllSettings } from './settingsStore';
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  testGoogleDriveConnection,
  testGoogleDriveUpload,
  pickDriveFolder,
  getPrinters,
  testPrinter,
  runDiagnostics,
} from './gdriveService';

type Screen = 'home' | 'project-list' | 'new-event' | 'event-file' | 'photobooth-session' | 'settings';

function statusToAccent(status: string): string {
  if (status === 'Active') return '#44a96f';
  if (status === 'Ended') return '#837a73';
  return '#f56a2d';
}

const ProjectList = ({ events, onHome, onOpen, onNew, onEditEvent }: { events: R3aEvent[]; onHome: () => void; onOpen: (event: R3aEvent) => void; onNew: () => void; onEditEvent: (event: R3aEvent) => void }) => {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => { if (activeIndex >= events.length) setActiveIndex(0); }, [events.length, activeIndex]);

  const moveProject = (direction: number) => setActiveIndex((activeIndex + direction + events.length) % Math.max(events.length, 1));
  const event = events[activeIndex];

  if (events.length === 0) {
    return (
      <main className="project-list-screen">
        <div className="project-grain" aria-hidden="true" />
        <div className="project-rays" aria-hidden="true"><i /><i /><i /></div>
        <header className="project-heading"><p>R3A BOOTH</p><h1>PROJECT</h1><span /></header>
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
        <div className="project-actions"><button className="project-home-button" onClick={onHome} type="button">HOME</button><button className="new-project-button" onClick={onNew} type="button">NEW EVENT <span>+</span></button></div>
      </main>
    );
  }

  return (
    <main className="project-list-screen">
      <div className="project-grain" aria-hidden="true" />
      <div className="project-rays" aria-hidden="true"><i /><i /><i /></div>
      <header className="project-heading"><p>R3A BOOTH</p><h1>PROJECT</h1><span /></header>
      <button className="project-arrow project-arrow-left" aria-label="Previous project" onClick={() => moveProject(-1)} type="button"><ChevronLeft size={62} strokeWidth={1.5} /></button>
      <section className="project-card-wrap">
        <div className="project-card" style={{ '--project-accent': statusToAccent(event.eventStatus) } as CSSProperties}>
          <div className="project-preview">
            <div className="preview-topbar"><span>R3A</span><span>BOOTH</span></div>
            <div className="preview-copy"><small>EVENT PHOTO EXPERIENCE</small><strong>{event.eventName || 'Untitled Event'}</strong><em>{event.date || 'No date set'}</em></div>
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
      <div className="project-actions"><button className="project-home-button" onClick={onHome} type="button">HOME</button><button className="new-project-button" onClick={onNew} type="button">NEW EVENT <span>+</span></button></div>
      <div className="project-dots" aria-label="Project position">{events.map((item, index) => <button key={item.id} className={index === activeIndex ? 'project-dot is-active' : 'project-dot'} aria-label={`Show ${item.eventName}`} onClick={() => setActiveIndex(index)} type="button" />)}</div>
    </main>
  );
};

type SettingsTab = 'camera' | 'storage' | 'application' | 'display' | 'security' | 'system';

type TestState = { status: 'idle' | 'running' | 'success' | 'error'; message: string };

const Settings = ({ onHome }: { onHome: () => void }) => {
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
    const clientId = settings.googleDrive.clientId;
    if (!clientId || clientId.trim().length < 10) {
      setGdriveTestState({ status: 'error', message: 'Please enter a Google OAuth Client ID first.' });
      return;
    }
    setGdriveConnecting(true);
    setGdriveTestState({ status: 'idle', message: '' });
    const result = await connectGoogleDrive(clientId);
    setGdriveConnecting(false);
    if (result.success) {
      update('googleDrive', { connected: true, account: result.account || 'Connected' });
    } else {
      setGdriveTestState({ status: 'error', message: result.error || 'Connection failed' });
    }
  };

  const handleDisconnectGdrive = async () => {
    await disconnectGoogleDrive();
    update('googleDrive', { connected: false, account: '', mainFolderId: '', mainFolderName: '', autoUpload: false });
    setGdriveTestState({ status: 'idle', message: '' });
    setGdriveUploadTestState({ status: 'idle', message: '' });
  };

  const handleReconnectGdrive = async () => {
    const clientId = settings.googleDrive.clientId;
    if (!clientId) {
      setGdriveTestState({ status: 'error', message: 'No Client ID configured.' });
      return;
    }
    setGdriveConnecting(true);
    setGdriveTestState({ status: 'idle', message: '' });
    const result = await connectGoogleDrive(clientId);
    setGdriveConnecting(false);
    if (result.success) {
      update('googleDrive', { connected: true, account: result.account || 'Connected' });
    } else {
      setGdriveTestState({ status: 'error', message: result.error || 'Reconnect failed' });
    }
  };

  const handleChangeFolder = async () => {
    const clientId = settings.googleDrive.clientId;
    if (!clientId) {
      setGdriveTestState({ status: 'error', message: 'No Client ID configured.' });
      return;
    }
    setGdrivePicking(true);
    setGdriveTestState({ status: 'idle', message: '' });
    try {
      const folder = await pickDriveFolder(clientId);
      if (folder) {
        update('googleDrive', { mainFolderId: folder.id, mainFolderName: folder.name });
      }
    } catch (err) {
      setGdriveTestState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to open folder picker' });
    }
    setGdrivePicking(false);
  };

  const handleTestGdrive = async () => {
    setGdriveTestState({ status: 'running', message: 'Testing...' });
    const result = await testGoogleDriveConnection(settings.googleDrive.clientId);
    setGdriveTestState({ status: result.success ? 'success' : 'error', message: result.message });
  };

  const handleTestGdriveUpload = async () => {
    setGdriveUploadTestState({ status: 'running', message: 'Uploading test file...' });
    const result = await testGoogleDriveUpload(settings.googleDrive.clientId);
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
                  <p>Connect your Google account to select a main folder for photo storage. You will need a Google OAuth Client ID from the Google Cloud Console.</p>
                  <div className="setting-control gdrive-client-id-row">
                    <span>OAUTH CLIENT ID</span>
                    <input
                      value={settings.googleDrive.clientId}
                      onChange={(e) => update('googleDrive', { clientId: e.target.value })}
                      placeholder="xxxxxx.apps.googleusercontent.com"
                      type="text"
                    />
                  </div>
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
                    <span>MAIN FOLDER</span>
                    <div className="gdrive-folder-row">
                      <button type="button" className="gdrive-folder-display">
                        <FolderOpen size={16} />
                        {settings.googleDrive.mainFolderName || 'No folder selected'}
                      </button>
                      <button type="button" className="gdrive-change-folder" onClick={handleChangeFolder} disabled={gdrivePicking}>
                        {gdrivePicking ? 'OPENING...' : 'CHANGE FOLDER'}
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
              <div className="setting-control">
                <span>APP VERSION</span>
                <button type="button">{settings.system.appVersion}<b>▼</b></button>
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
  const [events, setEvents] = useState<R3aEvent[]>([]);
  const [activeEvent, setActiveEvent] = useState<R3aEvent | null>(null);
  const [editingEvent, setEditingEvent] = useState<R3aEvent | null>(null);
  const [settings, setSettings] = useState<AllSettings>(() => loadAllSettings());

  const refreshEvents = async () => { setEvents(await getAllEvents()); };
  useEffect(() => { void refreshEvents(); }, []);

  if (screen === 'project-list') {
    return <ProjectList events={events} onHome={() => setScreen('home')} onOpen={(event) => { setActiveEvent(event); setScreen('photobooth-session'); }} onNew={() => { setEditingEvent(createEmptyEvent()); setScreen('event-file'); }} onEditEvent={(event) => { setEditingEvent(event); setScreen('event-file'); }} />;
  }

  if (screen === 'event-file' && editingEvent) {
    return <EventFile event={editingEvent} onSaved={async (saved) => { await refreshEvents(); setEditingEvent(saved); setScreen('project-list'); }} onHome={() => setScreen('project-list')} />;
  }

  if (screen === 'photobooth-session' && activeEvent) {
    return <PhotoboothSession event={activeEvent} cameraSettings={settings.camera} allSettings={settings} onExit={() => setScreen('project-list')} />;
  }

  if (screen === 'photobooth-session' && !activeEvent) {
    return (
      <main className="photobooth-screen photobooth-kiosk" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <AlertCircle size={48} strokeWidth={1} />
        <h2 style={{ fontSize: 24, margin: 0 }}>Event not found</h2>
        <p style={{ color: 'rgba(255,255,255,.5)', margin: 0 }}>The event data is missing or malformed.</p>
        <button onClick={() => setScreen('project-list')} type="button" style={{ marginTop: 8, padding: '10px 24px', background: '#ef3f25', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }}>BACK</button>
      </main>
    );
  }

  if (screen === 'settings') {
    return <Settings onHome={() => { setSettings(loadAllSettings()); setScreen('home'); }} />;
  }

  return (
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
  );
}

export default App;
