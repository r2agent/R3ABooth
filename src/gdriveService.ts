// Google Drive integration via Google Identity Services (GIS) Authorization Code flow
// and Google Picker API for folder selection.
//
// Security model:
// - OAuth uses authorization code flow (server-side token exchange) — client_secret stays on server.
// - Access token kept in memory + sessionStorage (per-tab).
// - Refresh token kept in IndexedDB (survives refresh, cleared on disconnect).
// - Backend endpoints:
//     POST /api/auth/exchange  { code, redirect_uri }  -> tokens
//     POST /api/auth/refresh   { refresh_token }       -> new access_token
// - Admin enters their own Google OAuth Client ID in Settings; it is stored in localStorage
//   alongside other non-sensitive settings (a Client ID is public by design).

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

const REDIRECT_URI =
  typeof window !== 'undefined'
    ? `${window.location.origin}/api/auth/callback`
    : '/api/auth/callback';

const TOKEN_SS_KEY = 'r3a.gdrive.accessToken';
const EXPIRY_SS_KEY = 'r3a.gdrive.tokenExpiry';
const ACCOUNT_SS_KEY = 'r3a.gdrive.account';

// --- Token state -------------------------------------------------------------

let accessToken: string | null = null;
let tokenExpiry = 0;
let lastKnownAccount: string | null = null;
let codeClient: CodeClient | null = null;
let currentClientId = '';
let refreshInFlight: Promise<string> | null = null;

type CodeClient = {
  requestCode: () => void;
  callback?: (resp: { code?: string; scope?: string; error?: string; error_description?: string }) => void;
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
  } catch {
    /* ignore */
  }
}

// Restore access token from sessionStorage on module load (per-tab)
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

// --- IndexedDB for refresh token --------------------------------------------

const IDB_NAME = 'r3a-booth';
const IDB_STORE = 'gdriveAuth';
const IDB_VERSION = 3;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

async function idbSet(key: string, value: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key: string): Promise<string | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ? (req.result.value as string) : null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function saveRefreshToken(token: string): Promise<void> {
  await idbSet('refresh_token', token);
}

async function getRefreshToken(): Promise<string | null> {
  return idbGet('refresh_token').catch(() => null);
}

async function clearRefreshToken(): Promise<void> {
  await idbDelete('refresh_token').catch(() => {});
}

// --- Google Identity Services loader ----------------------------------------

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

// --- Google Picker loader ---------------------------------------------------

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

// --- Authorization Code flow -------------------------------------------------

function initCodeClient(clientId: string): Promise<void> {
  return loadGis().then(() => {
    currentClientId = clientId;
    codeClient = google.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope: SCOPES,
      ux_mode: 'popup',
      redirect_uri: REDIRECT_URI,
      callback: () => { /* set per-request */ },
    });
  });
}

/**
 * Request an authorization code via GIS, then exchange it server-side
 * for access_token + refresh_token.
 */
async function requestTokens(clientId: string): Promise<{ accessToken: string; expiresIn: number; refreshToken: string | null }> {
  await initCodeClient(clientId);

  const code = await new Promise<string>((resolve, reject) => {
    if (!codeClient) {
      reject(new Error('Code client not initialized'));
      return;
    }
    codeClient.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error_description || resp.error));
        return;
      }
      if (!resp.code) {
        reject(new Error('No authorization code returned'));
        return;
      }
      resolve(resp.code);
    };
    codeClient.requestCode();
  });

  // Exchange code -> tokens via our backend
  const res = await fetch('/api/auth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirect_uri: REDIRECT_URI }),
  });

  if (!res.ok) {
    let msg = `Token exchange failed (HTTP ${res.status})`;
    try {
      const err = await res.json();
      if (err?.error_description) msg = err.error_description;
      else if (err?.error) msg = err.error;
    } catch { /* keep default */ }
    throw new Error(msg);
  }

  const data = await res.json() as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };

  if (!data.access_token) {
    throw new Error('No access_token in exchange response');
  }

  const expiresIn = data.expires_in ?? 3600;
  const refreshToken = data.refresh_token ?? null;

  setAccessToken(data.access_token, Date.now() + expiresIn * 1000);
  if (refreshToken) {
    await saveRefreshToken(refreshToken);
  }

  return { accessToken: data.access_token, expiresIn, refreshToken };
}

/**
 * Refresh access token via backend using stored refresh_token.
 */
async function refreshAccessToken(): Promise<string> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available. Please reconnect Google Drive.');
    }

    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) {
      let msg = `Token refresh failed (HTTP ${res.status})`;
      try {
        const err = await res.json();
        if (err?.error_description) msg = err.error_description;
        else if (err?.error) msg = err.error;
      } catch { /* keep default */ }
      // If refresh_token is revoked/invalid, clear it so user knows to reconnect
      if (msg.includes('invalid_grant') || msg.includes('revoked')) {
        await clearRefreshToken();
        setAccessToken(null, 0);
        setAccount(null);
      }
      throw new Error(msg);
    }

    const data = await res.json() as {
      access_token?: string;
      expires_in?: number;
    };

    if (!data.access_token) {
      throw new Error('No access_token in refresh response');
    }

    const expiresIn = data.expires_in ?? 3600;
    setAccessToken(data.access_token, Date.now() + expiresIn * 1000);
    return data.access_token;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

// --- Public API --------------------------------------------------------------

export function getValidToken(clientId: string): Promise<string> {
  // 1. Token masih valid, pakai langsung
  if (accessToken && Date.now() < tokenExpiry - 60000) {
    return Promise.resolve(accessToken);
  }

  // 2. Token expired, coba refresh via refresh_token (tanpa user gesture)
  return refreshAccessToken().catch(async (err) => {
    // 3. Refresh gagal (misal refresh token di-revoke)
    //    Fallback: minta user login ulang
    if (err instanceof Error && err.message.includes('No refresh token')) {
      // fallback ke interactive
      const tokens = await requestTokens(clientId);
      return tokens.accessToken;
    }
    // Kalau refresh token invalid, minta user login ulang juga
    if (err instanceof Error && (err.message.includes('invalid_grant') || err.message.includes('revoked'))) {
      const tokens = await requestTokens(clientId);
      return tokens.accessToken;
    }
    throw err;
  });
}

/** Fetch the user's email from the userinfo endpoint. */
async function fetchUserEmail(token: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch user info');
  const data = await res.json() as { email?: string };
  return data.email || 'Unknown account';
}

export async function connectGoogleDrive(clientId: string): Promise<DriveConnectResult> {
  if (!clientId || clientId.trim().length < 10) {
    return { success: false, error: 'Please enter a valid Google OAuth Client ID in the field above.' };
  }
  try {
    const tokens = await requestTokens(clientId);
    const email = await fetchUserEmail(tokens.accessToken);
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
    } catch { /* best-effort revoke */ }
  }
  setAccessToken(null, 0);
  setAccount(null);
  await clearRefreshToken();
  codeClient = null;
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
  hasRefreshToken: boolean;
};

export async function getTokenStatus(): Promise<TokenStatus> {
  const now = Date.now();
  const hasToken = !!accessToken && now < tokenExpiry;
  const refreshToken = await getRefreshToken().catch(() => null);
  return {
    hasToken,
    expiresAt: accessToken ? tokenExpiry : null,
    expiresInMs: hasToken ? tokenExpiry - now : null,
    account: lastKnownAccount,
    hasRefreshToken: !!refreshToken,
  };
}