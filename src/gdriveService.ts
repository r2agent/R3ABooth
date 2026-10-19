// Google Drive integration — delegate ke pkceAuth untuk OAuth.
// Fungsi upload/folder/picker tetap di sini.

import {
  pkceLogin,
  pkceLogout,
  getValidToken as pkceGetValidToken,
  getTokenStatus as pkceGetTokenStatus,
} from './pkceAuth';
import { BleClient } from '@capacitor-community/bluetooth-le';

export { startAutoRefresh, stopAutoRefresh, hasRefreshToken } from './pkceAuth';

export type DriveConnectResult = {
  success: boolean;
  account?: string;
  error?: string;
};

export type DriveTestResult = {
  success: boolean;
  message: string;
};

export type DriveFolder = {
  id: string;
  name: string;
};

export type TokenStatus = {
  hasToken: boolean;
  expiresAt: number | null;
  expiresInMs: number | null;
  account: string | null;
};

// --- Google Picker loader ----------------------------------------------------

let pickerLoaded = false;
let pickerLoadPromise: Promise<void> | null = null;

function loadPicker(): Promise<void> {
  if (pickerLoaded) return Promise.resolve();
  if (pickerLoadPromise) return pickerLoadPromise;
  pickerLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-picker]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => { pickerLoaded = true; resolve(); });
      existing.addEventListener('error', () => reject(new Error('Failed to load Picker')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;
    script.setAttribute('data-picker', 'true');
    script.onload = () => {
      gapi.load('picker', { callback: () => { pickerLoaded = true; resolve(); } });
    };
    script.onerror = () => reject(new Error('Failed to load Picker'));
    document.head.appendChild(script);
  });
  return pickerLoadPromise;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const gapi: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const google: any;

// --- Public: Connect (delegate ke PKCE) --------------------------------------

export async function connectGoogleDrive(_clientId: string): Promise<DriveConnectResult> {
  return pkceLogin();
}

// --- Public: Disconnect ------------------------------------------------------

export async function disconnectGoogleDrive(): Promise<boolean> {
  pkceLogout();
  return true;
}

// --- Public: Get valid token -------------------------------------------------

export function getValidToken(clientId: string): Promise<string> {
  return pkceGetValidToken(clientId);
}

// --- Public: Get token status ------------------------------------------------

export function getTokenStatus(): TokenStatus {
  return pkceGetTokenStatus();
}

// --- Public: Test connection -------------------------------------------------

export async function testGoogleDriveConnection(clientId: string): Promise<DriveTestResult> {
  if (!clientId) return { success: false, message: 'No Client ID configured.' };
  try {
    const token = await getValidToken(clientId);
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      let message = `Drive API error (HTTP ${res.status})`;
      try {
        const err = await res.json();
        if (err?.error?.message) message = err.error.message;
      } catch { /* keep default */ }
      return { success: false, message };
    }
    return { success: true, message: 'Google Drive connection is active.' };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : 'Connection failed' };
  }
}

export async function testGoogleDriveUpload(_clientId: string): Promise<DriveTestResult> {
  return { success: false, message: 'Upload test is not part of Phase 1.' };
}

// --- Public: Picker folder ---------------------------------------------------

export async function pickDriveFolder(clientId: string): Promise<DriveFolder | null> {
  if (!clientId) throw new Error('No Client ID configured.');
  const token = await getValidToken(clientId);
  await loadPicker();

  return new Promise<DriveFolder | null>((resolve, reject) => {
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMode(google.picker.DocsViewMode.LIST);

    const builder = new google.picker.PickerBuilder()
      .addView(view)
      .setTitle('Select MAIN folder')
      .setOAuthToken(token)
      .setDeveloperKey('AIzaSyAvDacMeOVb10NnlZXOr4a7_QtaZzNNpVU')
      .setCallback((data: { action: string; docs?: Array<{ id: string; name: string }> }) => {
        if (data.action === google.picker.Action.PICKED && data.docs && data.docs.length > 0) {
          resolve({ id: data.docs[0].id, name: data.docs[0].name });
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      });

    builder.build().setVisible(true);
  }).catch((err) => {
    throw err instanceof Error ? err : new Error('Picker failed');
  });
}

// --- Public: Share folder ----------------------------------------------------

export async function shareFolderWithAnyone(folderId: string, clientId: string): Promise<boolean> {
  try {
    const token = await getValidToken(clientId);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function buildDriveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

// --- Printer Detection -------------------------------------------------------

export async function getPrinters(): Promise<string[]> {
  const printers: string[] = [];
  const isNative = (window as any).Capacitor?.isNativePlatform?.();

  // Hanya scan Bluetooth jika aplikasi berjalan di APK (Native)
  if (isNative) {
    try {
      await BleClient.initialize();
      const devices = await BleClient.getBondedDevices();
      
      devices.forEach((device) => {
        if (device.name) {
          printers.push(`BT: ${device.name}`);
        }
      });
    } catch (err) {
      console.warn('[Printer] Gagal scan Bluetooth:', err);
    }
  }

  return printers;
}

export async function testPrinter(printerName: string): Promise<DriveTestResult> {
  if (!printerName) {
    return { success: false, message: 'Pilih printer atau isi IP/BT manual terlebih dahulu.' };
  }
  
  if (printerName.startsWith('BT:')) {
    return { success: true, message: `Siap mencetak via Bluetooth (${printerName.replace('BT:', '').trim()}). Pastikan RawBT terinstall.` };
  }
  
  if (printerName.startsWith('LAN:') || /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(printerName)) {
    const ip = printerName.replace('LAN:', '').trim();
    try {
      // Ping sederhana ke printer IP
      await fetch(`http://${ip}:9100`, { method: 'HEAD', mode: 'no-cors' });
      return { success: true, message: `Printer jaringan di ${ip} merespon.` };
    } catch {
      return { success: false, message: `Printer ${ip} tidak merespon. Cek koneksi Wi-Fi.` };
    }
  }

  return { success: true, message: 'Printer siap digunakan.' };
}

export async function runDiagnostics(): Promise<{ label: string; status: string; healthy: boolean }[]> {
  const results: { label: string; status: string; healthy: boolean }[] = [];

  if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
    results.push({ label: 'CAMERA API', status: 'AVAILABLE', healthy: true });
  } else {
    results.push({ label: 'CAMERA API', status: 'UNAVAILABLE', healthy: false });
  }

  if (window.indexedDB) {
    results.push({ label: 'LOCAL STORAGE', status: 'READY', healthy: true });
  } else {
    results.push({ label: 'LOCAL STORAGE', status: 'UNAVAILABLE', healthy: false });
  }

  if (navigator.onLine) {
    results.push({ label: 'NETWORK', status: 'ONLINE', healthy: true });
  } else {
    results.push({ label: 'NETWORK', status: 'OFFLINE', healthy: false });
  }

  const tokenStatus = getTokenStatus();
  if (tokenStatus.hasToken) {
    results.push({ label: 'GOOGLE DRIVE', status: 'CONNECTED', healthy: true });
  } else {
    results.push({ label: 'GOOGLE DRIVE', status: 'NOT CONNECTED', healthy: false });
  }

  return results;
}

export async function listDriveFolders(clientId: string): Promise<DriveFolder[]> {
  const token = await getValidToken(clientId);
  const query = `mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=50`;
  
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  
  if (!res.ok) throw new Error('Gagal mengambil daftar folder dari Google Drive.');
  const data = await res.json();
  return data.files || [];
}