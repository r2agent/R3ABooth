// Vercel Serverless Function: tukar authorization code ke access + refresh token.
//
// Dipanggil dari frontend setelah user menyelesaikan OAuth consent.
// Input body JSON: { code: string, redirect_uri: string }
// Output JSON: { access_token, refresh_token, expires_in, scope, token_type }
//             atau { error: string, error_description?: string }

export const config = {
  runtime: 'edge', // pakai Edge Runtime (lebih cepat, gratis di Vercel)
};

type ExchangeBody = {
  code?: string;
  redirect_uri?: string;
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: ExchangeBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { code, redirect_uri } = body;
  if (!code || !redirect_uri) {
    return new Response(
      JSON.stringify({ error: 'missing_params', error_description: 'code and redirect_uri are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response(
      JSON.stringify({ error: 'server_misconfigured', error_description: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri,
    grant_type: 'authorization_code',
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
      JSON.stringify({ error: 'network_error', error_description: 'Failed to reach Google token endpoint' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const text = await googleRes.text();
  return new Response(text, {
    status: googleRes.status,
    headers: { 'Content-Type': 'application/json' },
  });
}