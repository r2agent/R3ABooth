/* ============================================================
   PKCE AUTH — OAuth 2.0 with PKCE + Refresh Token
   Backend: /api/* (Vercel API Routes)
   ============================================================ */

const BACKEND_URL = '/api';

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) || '';
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';

const REFRESH_STORAGE_KEY = 'r3a.pkce.refreshToken';
const ACCOUNT_STORAGE_KEY = 'r3a.pkce.account';
const ACCESS_STORAGE_KEY = 'r3a.pkce.accessToken';
const EXPIRY_STORAGE_KEY = 'r3a.pkce.expiry';

// --- Token state (memory) ----------------------------------------------------

let accessToken: string | null = null;
let tokenExpiry = 0;
let refreshToken: string | null = null;
let account: string | null = null;

// Load dari sessionStorage saat init
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

// --- PKCE helpers ------------------------------------------------------------

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
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// --- Login (open popup, PKCE flow) -------------------------------------------

export async function pkceLogin(): Promise<{ success: boolean; account?: string; error?: string }> {
  if (!CLIENT_ID) return { success: false, error: 'Client ID not configured' };

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

      try {
        const res = await fetch(`${BACKEND_URL}/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: event.data.code,
            codeVerifier,
            redirectUri,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          resolve({ success: false, error: data.error || 'Exchange failed' });
          return;
        }

        accessToken = data.accessToken;
        tokenExpiry = Date.now() + (data.expiresIn * 1000);
        refreshToken = data.refreshToken;
        account = data.email;
        persist();

        resolve({ success: true, account: data.email || undefined });
      } catch (err) {
        resolve({ success: false, error: err instanceof Error ? err.message : 'Unknown' });
      }
    };

    window.addEventListener('message', handler);

    // Timeout
    setTimeout(() => {
      window.removeEventListener('message', handler);
      if (popup && !popup.closed) popup.close();
      resolve({ success: false, error: 'Login timeout' });
    }, 5 * 60 * 1000);
  });
}

// --- Auto-refresh ------------------------------------------------------------

let refreshInProgress: Promise<boolean> | null = null;

export async function ensureFreshToken(): Promise<string | null> {
  if (accessToken && Date.now() < tokenExpiry - 60000) {
    return accessToken;
  }

  if (!refreshToken) return null;

  if (refreshInProgress) {
    const ok = await refreshInProgress;
    return ok ? accessToken : null;
  }

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

// --- Public: get valid token -------------------------------------------------

export async function getValidToken(_clientId: string): Promise<string> {
  const token = await ensureFreshToken();
  if (!token) throw new Error('Token expired, please login again');
  return token;
}

// --- Public: logout ----------------------------------------------------------

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

// --- Public: status ----------------------------------------------------------

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

// --- Public: auto-refresh interval -------------------------------------------

let refreshIntervalId: ReturnType<typeof setInterval> | null = null;

export function startAutoRefresh(): void {
  if (refreshIntervalId) return;
  refreshIntervalId = setInterval(() => {
    void ensureFreshToken();
  }, 50 * 60 * 1000);
}

export function stopAutoRefresh(): void {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }
}