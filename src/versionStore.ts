/* ============================================================
   VERSION STORE — manage app version (v1.0.0 / v2.0.0 / v2.1.0)
   ============================================================ */

export type AppVersion = 'v1.0.0' | 'v2.0.0' | 'v2.1.0';

export type VersionInfo = {
  id: AppVersion;
  label: string;
  description: string;
};

export const AVAILABLE_VERSIONS: VersionInfo[] = [
  { id: 'v1.0.0', label: 'v1.0.0', description: 'IG Gate active' },
  { id: 'v2.0.0', label: 'v2.0.0', description: 'QRIS Payment Gate' },
  { id: 'v2.1.0', label: 'v2.1.0', description: 'Receipt Mode (Thermal Print, Dual Save)' },
];

const STORAGE_KEY = 'r3a-app-version';
const DEFAULT_VERSION: AppVersion = 'v1.0.0';

/* Validasi versi ada di list */
function isValidVersion(value: unknown): value is AppVersion {
  if (typeof value !== 'string') return false;
  return AVAILABLE_VERSIONS.some((v) => v.id === value);
}

/* Load versi dari localStorage — aman dari semua error */
export function loadAppVersion(): AppVersion {
  try {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return DEFAULT_VERSION;
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (isValidVersion(raw)) return raw;
    return DEFAULT_VERSION;
  } catch {
    return DEFAULT_VERSION;
  }
}

/* Save versi ke localStorage — aman dari quota / permission error */
export function saveAppVersion(version: AppVersion): void {
  try {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    if (!isValidVersion(version)) return;
    window.localStorage.setItem(STORAGE_KEY, version);
  } catch {
    /* ignore — silent fail */
  }
}

/* Ambil info versi (label, description) */
export function getVersionInfo(version: AppVersion): VersionInfo {
  return (
    AVAILABLE_VERSIONS.find((v) => v.id === version) ||
    AVAILABLE_VERSIONS[0]
  );
}

/* Cek apakah versi valid */
export function isValidAppVersion(value: unknown): value is AppVersion {
  return isValidVersion(value);
}

/* Reset ke default */
export function resetAppVersion(): AppVersion {
  saveAppVersion(DEFAULT_VERSION);
  return DEFAULT_VERSION;
}