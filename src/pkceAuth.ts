/* ============================================================
   PKCE AUTH — support Web + Android APK
   Web: popup OAuth
   APK: Capacitor Browser + custom URL scheme
   ============================================================ */

import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';

const BACKEND_URL = '/api';

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) || '';
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';

const REFRESH_STORAGE_KEY = 'r3a.pkce.refreshToken';
const ACCOUNT_STORAGE_KEY = 'r3a.pkce.account';
const ACCESS_STORAGE_KEY = 'r3a.pkce.accessToken';
const EXPIRY_STORAGE_KEY = 'r3a.pkce.expiry';

// Custom URL scheme — SAMA dengan yang di AndroidManifest.xml
const APK_REDIRECT_URI = 'com.r3abooth.app://oauth/callback';

// --- Detect native platform ------------------------------------------------

function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  return !!w.Capacitor?.isNativePlatform?.();
}

// --- Token state -----------------------------------------------------------

let accessToken: string | null = null;
let tokenExpiry = 0;
let refreshToken: string | null = null;
let account: string | null = null;

try {
  accessToken = sessionStorage.getItem(ACCESS_STORAGE_KEY);
  tokenExpiry = Number(sessionStorage.getItem(EXPIRY_STORAGE_KEY) || 0) || 0;
  refreshToken = sessionStorage.getItem(REFRESH_STORAGE_KEY);
  account = sessionStorage.getItem(ACCOUNT_STORAGE_KEY);
} catch { /* ignore */ }

function persist(): void {
  try {
    if (accessToken) sessionStorage.setItem(ACCESS_STORAGE_KEY, accessToken);
    if (tokenExpiry) sessionStorage.setItem(EXPIRY_STORAGE_KEY, String(tokenExpiry));
    if (refreshToken) sessionStorage.setItem(REFRESH_STORAGE_KEY, refreshToken);
    if (account) sessionStorage.setItem(ACCOUNT_STORAGE_KEY, account);
  } catch { /* ignore */ }
}

// --- PKCE helpers ----------------------------------------------------------

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

function base64UrlEncode(buffer: Uint8Array): string {
  let str = '';
  for (let i = 0; i < buffer.length; i++) {
    str += String.fromCharCode(buffer[i]);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// --- Tukar code → token ----------------------------------------------------

async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<{ success: boolean; account?: string; error?: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, codeVerifier, redirectUri }),
    });

    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Exchange failed' };
    }

    accessToken = data.accessToken;
    tokenExpiry = Date.now() + (data.expiresIn * 1000);
    refreshToken = data.refreshToken;
    account = data.email;
    persist();

    console.log('[PKCE] ✅ Login sukses! Account:', data.email);
    return { success: true, account: data.email };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown' };
  }
}

// ============================================================
// APK LOGIN — pakai Capacitor Browser
// ============================================================

async function pkceLoginAPK(): Promise<{ success: boolean; account?: string; error?: string }> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const redirectUri = APK_REDIRECT_URI;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return new Promise((resolve) => {
    let resolved = false;

    // Listener untuk app URL open (callback dari Google)
    const listenerPromise = App.addListener('appUrlOpen', async (data) => {
      if (resolved) return;
      console.log('[PKCE/APK] appUrlOpen:', data.url);

      if (!data.url.startsWith(APK_REDIRECT_URI)) return;

      resolved = true;

      try {
        const url = new URL(data.url);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          resolve({ success: false, error });
          return;
        }
        if (!code) {
          resolve({ success: false, error: 'No code in callback' });
          return;
        }

        const result = await exchangeCodeForToken(code, codeVerifier, redirectUri);
        resolve(result);
      } catch (err) {
        resolve({ success: false, error: err instanceof Error ? err.message : 'Parse failed' });
      }
    });

    // Buka OAuth di Chrome Custom Tab
    void Browser.open({ url: authUrl });

    // Timeout 5 menit
    setTimeout(async () => {
      if (resolved) return;
      resolved = true;
      try {
        const listener = await listenerPromise;
        await listener.remove();
      } catch { /* ignore */ }
      void Browser.close().catch(() => {});
      resolve({ success: false, error: 'Login timeout' });
    }, 5 * 60 * 1000);

    // Cleanup setelah selesai
    void listenerPromise.then((l) => {
      const checkDone = setInterval(async () => {
        if (resolved) {
          clearInterval(checkDone);
          try { await l.remove(); } catch { /* ignore */ }
          void Browser.close().catch(() => {});
        }
      }, 1000);
    });
  });
}

// ============================================================
// WEB LOGIN — pakai popup (existing)
// ============================================================

async function pkceLoginWeb(): Promise<{ success: boolean; account?: string; error?: string }> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const redirectUri = `${window.location.origin}${BACKEND_URL}/oauthCallback`;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return new Promise((resolve) => {
    const popup = window.open(authUrl, 'r3a-oauth', 'width=500,height=600');

    const handler = async (event: MessageEvent) => {
      if (event.data?.type !== 'r3a-oauth-callback') return;
      window.removeEventListener('message', handler);

      if (event.data.error) {
        resolve({ success: false, error: event.data.error });
        return;
      }
      if (!event.data.code) {
        resolve({ success: false, error: 'No code received' });
        return;
      }

      const result = await exchangeCodeForToken(event.data.code, codeVerifier, redirectUri);
      resolve(result);
    };

    window.addEventListener('message', handler);

    setTimeout(() => {
      window.removeEventListener('message', handler);
      if (popup && !popup.closed) popup.close();
      resolve({ success: false, error: 'Login timeout' });
    }, 5 * 60 * 1000);
  });
}

// --- Public: Login (auto-detect platform) -----------------------------------

export async function pkceLogin(): Promise<{ success: boolean; account?: string; error?: string }> {
  if (!CLIENT_ID) return { success: false, error: 'Client ID not configured' };

  if (isNativePlatform()) {
    console.log('[PKCE] Platform: APK (native)');
    return pkceLoginAPK();
  }

  console.log('[PKCE] Platform: Web');
  return pkceLoginWeb();
}

// --- Auto-refresh ----------------------------------------------------------

let refreshInProgress: Promise<boolean> | null = null;

export async function ensureFreshToken(): Promise<string | null> {
  if (accessToken && Date.now() < tokenExpiry - 60000) {
    const minLeft = Math.floor((tokenExpiry - Date.now()) / 60000);
    console.log(`[PKCE] Token masih valid (${minLeft} menit lagi)`);
    return accessToken;
  }

  if (!refreshToken) {
    console.warn('[PKCE] Tidak ada refresh token');
    return null;
  }

  if (refreshInProgress) {
    const ok = await refreshInProgress;
    return ok ? accessToken : null;
  }

  console.log('[PKCE] Refreshing token...');

  refreshInProgress = (async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) return false;

      const data = await res.json();
      accessToken = data.accessToken;
      tokenExpiry = Date.now() + (data.expiresIn * 1000);
      persist();
      console.log('[PKCE] ✅ Token refreshed!');
      return true;
    } catch {
      return false;
    } finally {
      refreshInProgress = null;
    }
  })();

  const ok = await refreshInProgress;
  return ok ? accessToken : null;
}

// --- Public ----------------------------------------------------------------

export async function getValidToken(_clientId: string): Promise<string> {
  const token = await ensureFreshToken();
  if (!token) throw new Error('Token expired, please login again');
  return token;
}

export function pkceLogout(): void {
  accessToken = null;
  tokenExpiry = 0;
  refreshToken = null;
  account = null;
  try {
    sessionStorage.removeItem(ACCESS_STORAGE_KEY);
    sessionStorage.removeItem(EXPIRY_STORAGE_KEY);
    sessionStorage.removeItem(REFRESH_STORAGE_KEY);
    sessionStorage.removeItem(ACCOUNT_STORAGE_KEY);
  } catch { /* ignore */ }
}

export function getTokenStatus() {
  const hasToken = !!accessToken && Date.now() < tokenExpiry;
  return {
    hasToken,
    expiresAt: tokenExpiry || null,
    expiresInMs: hasToken ? tokenExpiry - Date.now() : null,
    account: account,
  };
}

export function hasRefreshToken(): boolean {
  return !!refreshToken;
}

let refreshIntervalId: ReturnType<typeof setInterval> | null = null;

export function startAutoRefresh(customIntervalMin?: number): void {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }

  let intervalMin = customIntervalMin ?? 50;
  try {
    const raw = localStorage.getItem('r3a-booth-settings-v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      const fromSettings = parsed?.googleDrive?.autoRefreshIntervalMin;
      if (typeof fromSettings === 'number' && fromSettings >= 1 && fromSettings <= 60) {
        intervalMin = fromSettings;
      }
    }
  } catch { /* keep default */ }

  const intervalMs = intervalMin * 60 * 1000;
  console.log(`[PKCE] Auto-refresh interval: ${intervalMin} menit`);

  refreshIntervalId = setInterval(() => {
    void ensureFreshToken();
  }, intervalMs);
}

export function stopAutoRefresh(): void {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }
}