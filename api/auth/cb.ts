export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  const APP_BASE = 'https://r3abooth-zeta.vercel.app';
  const REDIRECT_URI = 'https://r3abooth-zeta.vercel.app/api/auth/cb';

  if (error) {
    const p = new URLSearchParams({ oauth_error: error, oauth_error_description: errorDescription || '' });
    return Response.redirect(`${APP_BASE}/?${p.toString()}#settings`, 302);
  }
  if (!code) {
    const p = new URLSearchParams({ oauth_error: 'missing_code' });
    return Response.redirect(`${APP_BASE}/?${p.toString()}#settings`, 302);
  }

  let tokens: { access_token?: string; expires_in?: number; refresh_token?: string; error?: string; error_description?: string } = {};
  try {
    const res = await fetch(`${APP_BASE}/api/auth/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: REDIRECT_URI }),
    });
    tokens = await res.json();
    if (!res.ok) {
      const p = new URLSearchParams({
        oauth_error: tokens.error || 'exchange_failed',
        oauth_error_description: tokens.error_description || `HTTP ${res.status}`,
      });
      return Response.redirect(`${APP_BASE}/?${p.toString()}#settings`, 302);
    }
  } catch (err) {
    const p = new URLSearchParams({
      oauth_error: 'network_error',
      oauth_error_description: err instanceof Error ? err.message : 'unknown',
    });
    return Response.redirect(`${APP_BASE}/?${p.toString()}#settings`, 302);
  }

  const accessToken = tokens.access_token || '';
  const expiresIn = tokens.expires_in || 3600;
  const refreshToken = tokens.refresh_token || '';

  let email = 'Unknown account';
  try {
    const uRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (uRes.ok) {
      const u = await uRes.json() as { email?: string };
      email = u.email || 'Unknown account';
    }
  } catch { /* ignore */ }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Connecting...</title></head>
<body>
<script>
(async function() {
  try {
    sessionStorage.setItem('r3a.gdrive.accessToken', ${JSON.stringify(accessToken)});
    sessionStorage.setItem('r3a.gdrive.tokenExpiry', String(${Date.now() + expiresIn * 1000}));
    sessionStorage.setItem('r3a.gdrive.account', ${JSON.stringify(email)});
    ${refreshToken ? `
    await new Promise((resolve) => {
      const req = indexedDB.open('r3a-booth', 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('gdriveAuth')) {
          db.createObjectStore('gdriveAuth', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('gdriveAuth', 'readwrite');
        tx.objectStore('gdriveAuth').put({ key: 'refresh_token', value: ${JSON.stringify(refreshToken)} });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      req.onerror = () => resolve();
    });
    ` : ''}
    window.location.href = '/?oauth_success=1#settings';
  } catch (e) {
    window.location.href = '/?oauth_error=storage_failed#settings';
  }
})();
</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}