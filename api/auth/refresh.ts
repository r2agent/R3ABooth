// Vercel Serverless Function: refresh access token pakai refresh_token.
//
// Dipanggil dari frontend saat access token expired.
// Input body JSON: { refresh_token: string }
// Output JSON: { access_token, expires_in, scope, token_type }
//             atau { error: string, error_description?: string }
//
// CATATAN PENTING:
// Google TIDAK mengembalikan refresh_token baru saat refresh.
// Refresh token lama tetap dipakai. Jadi simpan yang lama.

export const config = {
  runtime: 'edge',
};

type RefreshBody = {
  refresh_token?: string;
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: RefreshBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { refresh_token } = body;
  if (!refresh_token) {
    return new Response(
      JSON.stringify({
        error: 'missing_params',
        error_description: 'refresh_token is required',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response(
      JSON.stringify({
        error: 'server_misconfigured',
        error_description: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token,
    grant_type: 'refresh_token',
  });

  let googleRes: Response;
  try {
    googleRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
  } catch {
    return new Response(
      JSON.stringify({
        error: 'network_error',
        error_description: 'Failed to reach Google token endpoint',
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const text = await googleRes.text();
  // Pastikan response selalu JSON-parseable.
  try {
    JSON.parse(text);
    return new Response(text, {
      status: googleRes.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    // Google kembalikan non-JSON (HTML error page). Bungkus jadi JSON.
    return new Response(
      JSON.stringify({
        error: 'google_error',
        error_description: text.slice(0, 300) || 'Unknown Google error',
      }),
      { status: googleRes.status, headers: { 'Content-Type': 'application/json' } },
    );
  }
}