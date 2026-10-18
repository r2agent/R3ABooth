/* ============================================================
   DEVICE INFO — deteksi tipe device, browser, OS, screen
   ============================================================ */
import { loadAllSettings } from './settingsStore';

export type DeviceInfo = {
  deviceType: 'mobile' | 'tablet' | 'desktop' | 'web' | 'windows';
  browser: string;
  os: string;
  screenSize: string;
};

export function getDeviceInfo(): DeviceInfo {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { deviceType: 'desktop', browser: 'Unknown', os: 'Unknown', screenSize: '0x0' };
  }

  const ua = navigator.userAgent;
  const width = window.screen?.width ?? window.innerWidth ?? 0;
  const height = window.screen?.height ?? window.innerHeight ?? 0;

  /* ---------- OS ---------- */
  let os = 'Unknown';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPad|iPhone|iPod/.test(ua)) os = 'iOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  /* ---------- Device Type ---------- */
  let deviceType: DeviceInfo['deviceType'] = 'desktop';

  const isIPad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && 'ontouchend' in document);
  const isAndroidTablet = /Android/i.test(ua) && !/Mobile/i.test(ua);
  const isMobileUA = /Mobile|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua);

  if (isIPad || isAndroidTablet) {
    deviceType = 'tablet';
  } else if (isMobileUA) {
    deviceType = 'mobile';
  } else if (width <= 768) {
    deviceType = 'mobile';
  } else if (width <= 1024) {
    deviceType = 'tablet';
  }

  /* ---------- Browser ---------- */
  let browser = 'Unknown';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua) && !/Edg/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';

  /* ⚡ DEVICE MODE OVERRIDE ⚡ */
  try {
    const settings = loadAllSettings();
    const override = settings.application?.deviceTypeOverride || 'auto';

    if (override === 'web') {
      deviceType = 'web';
      os = 'Web Mode';
    } else if (override === 'tablet') {
      deviceType = 'tablet';
      os = 'Tablet / iPad';
    } else if (override === 'windows') {
      deviceType = 'windows';
      os = 'Windows Mode';
    }
  } catch { /* silent fail */ }

  return {
    deviceType,
    browser,
    os,
    screenSize: `${width}x${height}`,
  };
}

export function formatDeviceType(t: string): string {
  if (t === 'mobile') return 'HP';
  if (t === 'tablet') return 'Tablet / iPad';
  if (t === 'web') return 'Web Browser';
  if (t === 'windows') return 'Windows Mode';
  return 'PC / Laptop';
}