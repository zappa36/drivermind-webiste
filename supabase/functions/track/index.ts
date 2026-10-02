// Page analytics collector — Supabase Edge Function.
//
// Receives anonymous event batches from the website (sendBeacon, so the
// body arrives as text/plain — no preflight) and bulk-inserts them into
// page_events. No cookies, no IPs stored, no user identifiers.
//
// Deploy with JWT verification disabled (public page, no logged-in user):
//   dashboard: uncheck "Enforce JWT verification"  ·  CLI: --no-verify-jwt

type Env = (key: string) => string | undefined;

const ALLOWED = (origin: string) =>
  /^https:\/\/(www\.)?parcelvox\.com$/.test(origin) ||
  origin === 'https://zappa36.github.io' ||
  /^http:\/\/localhost(:\d+)?$/.test(origin);

const cors = (origin: string) => ({
  'Access-Control-Allow-Origin': ALLOWED(origin) ? origin : 'https://parcelvox.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});

const trim = (v: unknown, n: number) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, n) : null;
};

export async function handle(req: Request, env: Env): Promise<Response> {
  const headers = cors(req.headers.get('origin') || '');

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers });

  const raw = await req.text();
  if (!raw || raw.length > 20000) return new Response(null, { status: 204, headers });

  let data: { s?: unknown; ev?: unknown[] };
  try {
    data = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 204, headers });
  }

  const session = trim(data.s, 64);
  const events = Array.isArray(data.ev) ? data.ev.slice(0, 50) : [];
  if (!session || !events.length) return new Response(null, { status: 204, headers });

  const rows = events.flatMap((e: any) => {
    if (!e || !['view', 'click', 'read'].includes(e.event)) return [];
    const seconds = Number(e.seconds);
    return [{
      session,
      event: e.event,
      target: trim(e.target, 160),
      section: trim(e.section, 60),
      seconds: Number.isFinite(seconds) ? Math.min(Math.max(Math.round(seconds), 0), 3600) : null,
      path: trim(e.path, 120),
      referrer: trim(e.referrer, 160),
      viewport: trim(e.viewport, 20),
    }];
  });
  if (!rows.length) return new Response(null, { status: 204, headers });

  const supabaseUrl = env('SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return new Response(null, { status: 204, headers });

  await fetch(`${supabaseUrl}/rest/v1/page_events`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  }).catch(() => null);

  // Beacons never read the response; stay quiet whatever happened.
  return new Response(null, { status: 204, headers });
}

// Entry point on the Supabase Edge runtime; the guard lets the same file be
// imported for tests under Node.
declare const Deno: { serve?: (h: (req: Request) => Promise<Response>) => void; env: { get: (k: string) => string | undefined } };
if (typeof Deno !== 'undefined' && Deno.serve) {
  Deno.serve((req: Request) => handle(req, (k: string) => Deno.env.get(k)));
}
