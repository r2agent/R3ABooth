/* ============================================================
   VERSION STORE — manage app version (v1.0.0 / v2.0.0)
   User bisa switch kapan saja, tersimpan di localStorage.
   ============================================================ */

export type AppVersion = 'v1.0.0' | 'v2.0.0';

export const AVAILABLE_VERSIONS: { id: AppVersion; label: string; description: string }[] = [
  { id: 'v1.0.0', label: 'v1.0.0', description: 'Classic — stabil & teruji' },
  { id: 'v2.0.0', label: 'v2.0.0', description: 'Eksperimental — fitur baru' },
];

const STORAGE_KEY = 'r3a-app-version';

export function loadAppVersion(): AppVersion {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'v1.0.0' || raw === 'v2.0.0') return raw;
    return 'v1.0.0'; // default
  } catch {
    return 'v1.0.0';
  }
}

export function saveAppVersion(version: AppVersion): void {
  try {
    localStorage.setItem(STORAGE_KEY, version);
  } catch { /* ignore */ }
}

export function getVersionInfo(version: AppVersion) {
  return AVAILABLE_VERSIONS.find((v) => v.id === version) || AVAILABLE_VERSIONS[0];
}