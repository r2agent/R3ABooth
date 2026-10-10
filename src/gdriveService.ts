// Google Drive integration via Google Identity Services (GIS) implicit flow
// and Google Picker API for folder selection.
//
// Implicit flow: no backend, no refresh token, access token lives ~1 hour.
// Token kept in memory + sessionStorage (per-tab).

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

// --- Constants ---------------------------------------------------------------

const SCOPES =
  'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';

const TOKEN_SS_KEY = 'r3a.gdrive.accessToken';
const EXPIRY_SS_KEY = 'r3a.gdrive.tokenExpiry';
const ACCOUNT_SS_KEY = 'r3a.gdrive.account';

// --- Token state -------------------------------------------------------------

let accessToken: string | null = null;
let tokenExpiry = 0;
let lastKnownAccount: string | null = null;
let tokenClient: TokenClient | null = null;
let currentClientId = '';

type TokenClient = {
  requestAccessToken: (opts?: { prompt?: '' | 'consent' | 'select_account' }) => void;
  callback?: (resp: {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  }) => void;
};

// --- sessionStorage helpers --------------------------------------------------

function ssGet(key: string): string | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function ssSet(key: string, value: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch { /* ignore */ }
}

accessToken = ssGet(TOKEN_SS_KEY);
tokenExpiry = Number(ssGet(EXPIRY_SS_KEY) || 0) || 0;
lastKnownAccount = ssGet(ACCOUNT_SS_KEY);

function setAccessToken(token: string | null, expiry: number): void {
  accessToken = token;
  tokenExpiry = expiry;
  ssSet(TOKEN_SS_KEY, token);
  ssSet(EXPIRY_SS_KEY, expiry ? String(expiry) : null);
}

function setAccount(account: string | null): void {
  lastKnownAccount = account;
  ssSet(ACCOUNT_SS_KEY, account);
}

// --- GIS loader --------------------------------------------------------------

let gisLoaded = false;
let gisLoadPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (gisLoaded) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-gis]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => { gisLoaded = true; resolve(); });
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.setAttribute('data-gis', 'true');
    script.onload = () => { gisLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

// --- Picker loader -----------------------------------------------------------

let pickerLoaded = false;
let pickerLoadPromise: Promise<void> | null = null;

function loadPicker(): Promise<void> {
  if (pickerLoaded) return Promise.resolve();
  if (pickerLoadPromise) return pickerLoadPromise;
  pickerLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-picker]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => { pickerLoaded = true; resolve(); });
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Picker')));
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
    script.onerror = () => reject(new Error('Failed to load Google Picker'));
    document.head.appendChild(script);
  });
  return pickerLoadPromise;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const google: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const gapi: any;

// --- Implicit flow -----------------------------------------------------------

function initTokenClient(clientId: string): Promise<void> {
  return loadGis().then(() => {
    currentClientId = clientId;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: () => { /* handled per-request */ },
    });
  });
}

function requestToken(
  clientId: string,
  promptMode: '' | 'consent' | 'select_account' = '',
): Promise<string> {
  return initTokenClient(clientId).then(
    () =>
      new Promise<string>((resolve, reject) => {
        if (!tokenClient) {
          reject(new Error('Token client not initialized'));
          return;
        }
        tokenClient.callback = (resp) => {
          if (resp.error) {
            reject(new Error(resp.error_description || resp.error));
            return;
          }
          accessToken = resp.access_token || null;
          tokenExpiry = Date.now() + (resp.expires_in ? resp.expires_in * 1000 : 3600 * 1000);
          setAccessToken(accessToken, tokenExpiry);
          resolve(accessToken!);
        };
        tokenClient.requestAccessToken({ prompt: promptMode });
      }),
  );
}

export function getValidToken(clientId: string): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry - 60000) {
    return Promise.resolve(accessToken);
  }
  return requestToken(clientId, '');
}

async function fetchUserEmail(token: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch user info');
  const data = await res.json() as { email?: string };
  return data.email || 'Unknown account';
}

// --- Public API --------------------------------------------------------------

export async function connectGoogleDrive(clientId: string): Promise<DriveConnectResult> {
  if (!clientId || clientId.trim().length < 10) {
    return { success: false, error: 'Please enter a valid Google OAuth Client ID.' };
  }
  try {
    const token = await requestToken(clientId, 'consent');
    const email = await fetchUserEmail(token);
    setAccount(email);
    return { success: true, account: email };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Connection failed';
    return { success: false, error: msg };
  }
}

export async function disconnectGoogleDrive(): Promise<boolean> {
  if (accessToken) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${accessToken}`, { method: 'POST' });
    } catch { /* best-effort */ }
  }
  setAccessToken(null, 0);
  setAccount(null);
  tokenClient = null;
  currentClientId = '';
  return true;
}

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
      .setDeveloperKey('')
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

export async function getPrinters(): Promise<string[]> {
  return [];
}

export async function testPrinter(_printerName: string): Promise<DriveTestResult> {
  return { success: false, message: 'Printer test is not available in web mode.' };
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

  if (accessToken && Date.now() < tokenExpiry) {
    results.push({ label: 'GOOGLE DRIVE', status: 'CONNECTED', healthy: true });
  } else {
    results.push({ label: 'GOOGLE DRIVE', status: 'NOT CONNECTED', healthy: false });
  }

  return results;
}

// --- Operator dashboard helpers ---------------------------------------------

export type TokenStatus = {
  hasToken: boolean;
  expiresAt: number | null;
  expiresInMs: number | null;
  account: string | null;
};

export function getTokenStatus(): TokenStatus {
  const now = Date.now();
  const hasToken = !!accessToken && now < tokenExpiry;
  return {
    hasToken,
    expiresAt: accessToken ? tokenExpiry : null,
    expiresInMs: hasToken ? tokenExpiry - now : null,
    account: lastKnownAccount,
  };
}