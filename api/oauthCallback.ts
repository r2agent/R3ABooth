// GET /api/oauthCallback
// Endpoint redirect dari Google

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const { code, state, error } = req.query;

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
                state: ${JSON.stringify(state || null)},
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