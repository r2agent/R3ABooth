// Settings store — localStorage-backed.

export type CameraSettingsShape = {
  cameraOn: boolean;
  selectedDeviceId: string;
  resolution: string;
  frameRate: string;
  aspectRatio: string;
  orientation: string;
  mirror: boolean;
  previewQuality: string;
  lowLatency: boolean;
};

export type PrinterSettingsShape = {
  printerOn: boolean;
  printer: string;
  paperSize: string;
};

export type StorageSettingsShape = {
  fileNaming: string;
  savePhotos: boolean;
  saveVideos: boolean;
  autoDownloadResult: boolean;
  keepFiles: string;
};

export type GoogleDriveSettingsShape = {
  clientId: string;
  connected: boolean;
  account: string;
  mainFolderId: string;
  mainFolderName: string;
  autoUpload: boolean;
  useManualFolder: boolean;
  manualFolderInput: string;
  reminderEnabled: boolean;
  reminderIntervalMin: number;
};

export type ApplicationSettingsShape = {
  startupMode: string;
  language: string;
  checkUpdates: boolean;
  analytics: boolean;
};

export type DisplaySettingsShape = {
  displayMode: string;
  brightness: number;
  touchInput: boolean;
  idleScreen: string;
  showPrintButton: boolean;
  showQrButton: boolean;
  showDriveQrButton: boolean;
  idleTimeoutMin: number;
  slideDurationSec: number;
};

export type SecuritySettingsShape = {
  adminLock: boolean;
  adminPin: string;
  autoLock: string;
  accessLevel: string;
};

export type SystemSettingsShape = {
  appVersion: string;
  igGateEnabled: boolean;   // ⚠️ NEW: toggle gate follow IG
};

export type AllSettings = {
  camera: CameraSettingsShape;
  printer: PrinterSettingsShape;
  storage: StorageSettingsShape;
  googleDrive: GoogleDriveSettingsShape;
  application: ApplicationSettingsShape;
  display: DisplaySettingsShape;
  security: SecuritySettingsShape;
  system: SystemSettingsShape;
};

const STORAGE_KEY = 'r3a-booth-settings-v1';

const DEFAULT_SETTINGS: AllSettings = {
  camera: {
    cameraOn: true,
    selectedDeviceId: '',
    resolution: '1920 × 1080',
    frameRate: '30 FPS',
    aspectRatio: '16:9',
    orientation: 'LANDSCAPE',
    mirror: true,
    previewQuality: 'HIGH',
    lowLatency: false,
  },
  printer: {
    printerOn: false,
    printer: '',
    paperSize: '4 × 6 in',
  },
  storage: {
    fileNaming: '',
    savePhotos: true,
    saveVideos: true,
    autoDownloadResult: true,
    keepFiles: '30 DAYS',
  },
  googleDrive: {
    clientId: '',
    connected: false,
    account: '',
    mainFolderId: '',
    mainFolderName: '',
    autoUpload: true,
    useManualFolder: false,
    manualFolderInput: '',
    reminderEnabled: true,
    reminderIntervalMin: 50,
  },
  application: {
    startupMode: 'HOME SCREEN',
    language: 'ENGLISH',
    checkUpdates: true,
    analytics: false,
  },
  display: {
    displayMode: 'KIOSK',
    brightness: 100,
    touchInput: true,
    idleScreen: 'SLIDESHOW',
    showPrintButton: true,
    showQrButton: true,
    showDriveQrButton: true,
    idleTimeoutMin: 3,
    slideDurationSec: 5,
  },
  security: {
    adminLock: false,
    adminPin: '',
    autoLock: 'NEVER',
    accessLevel: 'ADMIN',
  },
  system: {
    appVersion: '1.0.0',
    igGateEnabled: true,
  },
};

export function loadAllSettings(): AllSettings {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AllSettings>;
    return {
      camera: { ...DEFAULT_SETTINGS.camera, ...(parsed.camera || {}) },
      printer: { ...DEFAULT_SETTINGS.printer, ...(parsed.printer || {}) },
      storage: { ...DEFAULT_SETTINGS.storage, ...(parsed.storage || {}) },
      googleDrive: { ...DEFAULT_SETTINGS.googleDrive, ...(parsed.googleDrive || {}) },
      application: { ...DEFAULT_SETTINGS.application, ...(parsed.application || {}) },
      display: { ...DEFAULT_SETTINGS.display, ...(parsed.display || {}) },
      security: { ...DEFAULT_SETTINGS.security, ...(parsed.security || {}) },
      system: { ...DEFAULT_SETTINGS.system, ...(parsed.system || {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAllSettings(settings: AllSettings): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}