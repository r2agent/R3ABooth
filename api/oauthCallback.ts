// GET /api/oauthCallback
// Handle redirect dari Google OAuth
// - State prefix "apk:" → redirect ke custom URL scheme (untuk APK)
// - Tanpa prefix → postMessage ke window.opener (untuk Web)

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const { code, state, error } = req.query;

  const stateStr = typeof state === 'string' ? state : '';
  const isAPK = stateStr.startsWith('apk:');
  const cleanState = isAPK ? stateStr.slice(4) : stateStr;

  console.log('[oauthCallback] code:', !!code, 'state:', stateStr, 'isAPK:', isAPK);

  // ⚠️ APK — redirect ke custom URL scheme
  if (isAPK) {
    const params = new URLSearchParams();
    if (code) params.set('code', String(code));
    if (cleanState) params.set('state', cleanState);
    if (error) params.set('error', String(error));

    const deepLink = `com.r3abooth.app://oauth/callback?${params.toString()}`;
    console.log('[oauthCallback] Redirecting to deep link:', deepLink);

    res.writeHead(302, { Location: deepLink });
    res.end();
    return;
  }

  // ⚠️ Web — return HTML yang postMessage ke opener
  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
      <head><title>OAuth Callback</title></head>
      <body style="background:#1a1614;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center">
          <p style="opacity:.7">Processing...</p>
        </div>
        <script>
          try {
            if (window.opener) {
              window.opener.postMessage({
                type: 'r3a-oauth-callback',
                code: ${JSON.stringify(code || null)},
                state: ${JSON.stringify(cleanState || null)},
                error: ${JSON.stringify(error || null)},
              }, '*');
            }
            setTimeout(function() { window.close(); }, 500);
          } catch (e) {
            document.body.innerHTML = '<p>Error: ' + e.message + '</p>';
          }
        </script>
      </body>
    </html>
  `);
}