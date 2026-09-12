export type CameraDevice = {
  deviceId: string;
  label: string;
};

export type CameraSettings = {
  selectedDeviceId: string;
  resolution: string;
  frameRate: string;
  aspectRatio: string;
  orientation: string;
  mirror: boolean;
  previewQuality: string;
  lowLatency: boolean;
  cameraOn: boolean;
};

const STORAGE_KEY = 'r3a-camera-settings';

const defaultSettings: CameraSettings = {
  selectedDeviceId: '',
  resolution: '1920 × 1080',
  frameRate: '30 FPS',
  aspectRatio: '16:9',
  orientation: 'LANDSCAPE',
  mirror: true,
  previewQuality: 'HIGH',
  lowLatency: true,
  cameraOn: true,
};

export function loadCameraSettings(): CameraSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

export function saveCameraSettings(settings: CameraSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore quota errors — settings are non-critical
  }
}

export async function enumerateCameras(): Promise<CameraDevice[]> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    // permission may be needed to see labels
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Camera ${i + 1}`,
      }));
  } catch {
    return [];
  }
}

export function getResolutionConstraint(res: string): { width: number; height: number } {
  switch (res) {
    case '1280 × 720': return { width: 1280, height: 720 };
    case '3840 × 2160': return { width: 3840, height: 2160 };
    default: return { width: 1920, height: 1080 };
  }
}

export function getFrameRateConstraint(fps: string): number {
  return fps.startsWith('30') ? 30 : 60;
}

export function getAspectRatioValue(ar: string): number {
  switch (ar) {
    case '4:3': return 4 / 3;
    case '1:1': return 1;
    case '9:16': return 9 / 16;
    default: return 16 / 9;
  }
}

export function getEffectiveResolution(settings: CameraSettings): { width: number; height: number } {
  const base = getResolutionConstraint(settings.resolution);
  if (settings.orientation === 'PORTRAIT') {
    return { width: base.height, height: base.width };
  }
  return base;
}

export function getPreviewQualityConstraint(quality: string): { width: number; height: number } | null {
  switch (quality) {
    case 'MEDIUM': return { width: 1280, height: 720 };
    case 'LOW': return { width: 640, height: 360 };
    default: return null;
  }
}
