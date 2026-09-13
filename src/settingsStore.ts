import { saveCameraSettings as saveCamInternal, loadCameraSettings as loadCamInternal, type CameraSettings } from './cameraStore';

export type PrinterSettings = {
  printerOn: boolean;
  printer: string;
  paperSize: string;
};

export type StorageSettings = {
  fileNaming: string;
  savePhotos: boolean;
  saveVideos: boolean;
  keepFiles: string;
  autoDownloadResult: boolean;
};

export type GoogleDriveSettings = {
  connected: boolean;
  account: string;
  mainFolderId: string;
  mainFolderName: string;
  clientId: string;
  autoUpload: boolean;
  uploadFolder: string;
};

export type ApplicationSettings = {
  startupMode: string;
  language: string;
  checkUpdates: boolean;
  analytics: boolean;
};

export type DisplaySettings = {
  displayMode: string;
  brightness: number;
  touchInput: boolean;
  idleScreen: string;
};

export type SecuritySettings = {
  adminLock: boolean;
  adminPin: string;
  autoLock: string;
  accessLevel: string;
};

export type SystemInfo = {
  appVersion: string;
};

export type AllSettings = {
  camera: CameraSettings;
  printer: PrinterSettings;
  storage: StorageSettings;
  googleDrive: GoogleDriveSettings;
  application: ApplicationSettings;
  display: DisplaySettings;
  security: SecuritySettings;
  system: SystemInfo;
};

const SETTINGS_KEY = 'r3a-all-settings';

const defaultPrinter: PrinterSettings = {
  printerOn: false,
  printer: 'No printer selected',
  paperSize: '4 × 6 in',
};

const defaultStorage: StorageSettings = {
  fileNaming: '{event}_{date}_{number}',
  savePhotos: true,
  saveVideos: false,
  keepFiles: '30 DAYS',
  autoDownloadResult: true,
};

const defaultGoogleDrive: GoogleDriveSettings = {
  connected: false,
  account: '',
  mainFolderId: '',
  mainFolderName: '',
  clientId: '',
  autoUpload: false,
  uploadFolder: 'R3A Booth',
};

const defaultApplication: ApplicationSettings = {
  startupMode: 'HOME SCREEN',
  language: 'ENGLISH',
  checkUpdates: true,
  analytics: false,
};

const defaultDisplay: DisplaySettings = {
  displayMode: 'FULLSCREEN',
  brightness: 100,
  touchInput: true,
  idleScreen: 'HOME SCREEN',
};

const defaultSecurity: SecuritySettings = {
  adminLock: false,
  adminPin: '',
  autoLock: 'NEVER',
  accessLevel: 'OPERATOR',
};

const defaultSystem: SystemInfo = {
  appVersion: 'R3A BOOTH 0.1.0',
};

export function loadAllSettings(): AllSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const camera = loadCamInternal();
    if (!raw) {
      return {
        camera,
        printer: { ...defaultPrinter },
        storage: { ...defaultStorage },
        googleDrive: { ...defaultGoogleDrive },
        application: { ...defaultApplication },
        display: { ...defaultDisplay },
        security: { ...defaultSecurity },
        system: { ...defaultSystem },
      };
    }
    const parsed = JSON.parse(raw) as Partial<AllSettings>;
    return {
      camera,
      printer: { ...defaultPrinter, ...parsed.printer },
      storage: { ...defaultStorage, ...parsed.storage },
      googleDrive: { ...defaultGoogleDrive, ...parsed.googleDrive },
      application: { ...defaultApplication, ...parsed.application },
      display: { ...defaultDisplay, ...parsed.display },
      security: { ...defaultSecurity, ...parsed.security },
      system: { ...defaultSystem, ...parsed.system },
    };
  } catch {
    return {
      camera: loadCamInternal(),
      printer: { ...defaultPrinter },
      storage: { ...defaultStorage },
      googleDrive: { ...defaultGoogleDrive },
      application: { ...defaultApplication },
      display: { ...defaultDisplay },
      security: { ...defaultSecurity },
      system: { ...defaultSystem },
    };
  }
}

export function saveAllSettings(settings: AllSettings): void {
  try {
    saveCamInternal(settings.camera);
    const { camera, ...rest } = settings;
    void camera;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
  } catch {
    // ignore quota errors
  }
}

export function getDefaultSettings(): AllSettings {
  return {
    camera: loadCamInternal(),
    printer: { ...defaultPrinter },
    storage: { ...defaultStorage },
    googleDrive: { ...defaultGoogleDrive },
    application: { ...defaultApplication },
    display: { ...defaultDisplay },
    security: { ...defaultSecurity },
    system: { ...defaultSystem },
  };
}
