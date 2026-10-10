// Vercel Serverless Function: OAuth callback handler.
//
// Google redirect ke sini setelah user approve (redirect mode / fallback).
// URL akan berisi query string: ?code=XXX&scope=YYY
// Handler ini:
//   1. Terima code dari query string.
//   2. Tukar code ke token via /api/auth/exchange.
//   3. Redirect balik ke app dengan status (success/error).

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  // Base URL untuk redirect balik
  const appBase = `${url.protocol}//${url.host}`;

  // Kalau Google kirim error (misal user deny)
  if (error) {
    const params = new URLSearchParams({
      oauth_error: error,
      oauth_error_description: errorDescription || '',
    });
    return Response.redirect(`${appBase}/?${params.toString()}#settings`, 302);
  }

  if (!code) {
    const params = new URLSearchParams({
      oauth_error: 'missing_code',
      oauth_error_description: 'No authorization code in callback URL',
    });
    return Response.redirect(`${appBase}/?${params.toString()}#settings`, 302);
  }

  // Tukar code ke token via exchange endpoint
  const redirectUri = `${appBase}/api/auth/callback`;
  let tokens: any;
  try {
    const res = await fetch(`${appBase}/api/auth/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
    });
    tokens = await res.json();
    if (!res.ok) {
      const params = new URLSearchParams({
        oauth_error: tokens?.error || 'exchange_failed',
        oauth_error_description: tokens?.error_description || `HTTP ${res.status}`,
      });
      return Response.redirect(`${appBase}/?${params.toString()}#settings`, 302);
    }
  } catch (err) {
    const params = new URLSearchParams({
      oauth_error: 'network_error',
      oauth_error_description: err instanceof Error ? err.message : 'unknown',
    });
    return Response.redirect(`${appBase}/?${params.toString()}#settings`, 302);
  }

  // Sukses → simpan tokens di sessionStorage via HTML bridge
  // Karena server tidak bisa langsung set sessionStorage, kita kirim
  // HTML kecil yang menyimpan token lalu redirect ke app.
  const accessToken = tokens.access_token || '';
  const expiresIn = tokens.expires_in || 3600;
  const refreshToken = tokens.refresh_token || '';
  const email = await fetchUserEmail(accessToken);

  const html = `<!DOCTYPE html>
<html>
<head><title>Connecting...</title></head>
<body>
<script>
  try {
    sessionStorage.setItem('r3a.gdrive.accessToken', ${JSON.stringify(accessToken)});
    sessionStorage.setItem('r3a.gdrive.tokenExpiry', String(${Date.now() + expiresIn * 1000}));
    sessionStorage.setItem('r3a.gdrive.account', ${JSON.stringify(email)});
    ${refreshToken ? `
    const idbReq = indexedDB.open('r3a-booth', 3);
    idbReq.onupgradeneeded = () => {
      const db = idbReq.result;
      if (!db.objectStoreNames.contains('gdriveAuth')) {
        db.createObjectStore('gdriveAuth', { keyPath: 'key' });
      }
    };
    idbReq.onsuccess = () => {
      const db = idbReq.result;
      const tx = db.transaction('gdriveAuth', 'readwrite');
      tx.objectStore('gdriveAuth').put({ key: 'refresh_token', value: ${JSON.stringify(refreshToken)} });
      tx.oncomplete = () => { window.location.href = '/?oauth_success=1#settings'; };
      tx.onerror = () => { window.location.href = '/?oauth_success=1#settings'; };
    };
    idbReq.onerror = () => { window.location.href = '/?oauth_success=1#settings'; };
    ` : `window.location.href = '/?oauth_success=1#settings';`}
  } catch (e) {
    window.location.href = '/?oauth_error=storage_failed#settings';
  }
</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function fetchUserEmail(token: string): Promise<string> {
  if (!token) return 'Unknown account';
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return 'Unknown account';
    const data = await res.json() as { email?: string };
    return data.email || 'Unknown account';
  } catch {
    return 'Unknown account';
  }
}