// Contact form relay — Supabase Edge Function.
//
// Flow: website form → this function → contacts table → Slack notification.
// The submission is saved first; Slack is notification only, so a Slack
// outage never loses a lead (the response reports notified: false instead).
//
// Secrets: SLACK_WEBHOOK_URL must be set in Edge Function secrets. It stays
// server-side — a webhook URL in the public repo or page would be found by
// secret scanning and auto-revoked by Slack. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
//
// Deploy with JWT verification disabled (public form, no logged-in user):
//   dashboard: uncheck "Enforce JWT verification"  ·  CLI: --no-verify-jwt

type Env = (key: string) => string | undefined;

const ALLOWED = (origin: string) =>
  origin === 'https://velovox.ai' ||
  origin === 'https://www.velovox.ai' ||
  origin === 'https://zappa36.github.io' ||
  /^http:\/\/localhost(:\d+)?$/.test(origin);

const cors = (origin: string) => ({
  'Access-Control-Allow-Origin': ALLOWED(origin) ? origin : 'https://zappa36.github.io',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Content-Type': 'application/json',
});

// Slack mrkdwn requires these three escapes.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const json = (status: number, headers: Record<string, string>, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers });

export async function handle(req: Request, env: Env): Promise<Response> {
  const headers = cors(req.headers.get('origin') || '');

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return json(405, headers, { error: 'Method not allowed' });

  const raw = await req.text();
  if (raw.length > 10000) return json(413, headers, { error: 'Payload too large' });

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw || '{}');
  } catch {
    return json(400, headers, { error: 'Invalid JSON' });
  }

  // Honeypot: the "website" field is invisible to humans. Bots fill it in;
  // pretend success so they don't adapt.
  if (data.website) return json(200, headers, { ok: true });

  const name = String(data.name || '').trim().slice(0, 200);
  const email = String(data.email || '').trim().slice(0, 200);
  const company = String(data.company || '').trim().slice(0, 200);
  const message = String(data.message || '').trim().slice(0, 2000);

  if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, headers, { error: 'Name, a valid email, and a message are required' });
  }

  const supabaseUrl = env('SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json(500, headers, { error: 'Relay not configured' });

  // Save the lead first — this is the part that must not fail silently.
  const insert = await fetch(`${supabaseUrl}/rest/v1/contacts`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ name, email, company: company || null, message }),
  });
  if (!insert.ok) return json(502, headers, { error: 'Could not save submission' });

  // Notify Slack; a failure here is logged in the response but not fatal.
  let notified = false;
  const webhook = env('SLACK_WEBHOOK_URL');
  if (webhook) {
    const slackRes = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `New website contact: ${name} <${email}>`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'New website contact', emoji: true } },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Name*\n${esc(name)}` },
              { type: 'mrkdwn', text: `*Email*\n${esc(email)}` },
              { type: 'mrkdwn', text: `*Company*\n${esc(company) || '—'}` },
            ],
          },
          { type: 'section', text: { type: 'mrkdwn', text: `*Message*\n${esc(message)}` } },
        ],
      }),
    }).catch(() => null);
    notified = !!(slackRes && slackRes.ok);
  }

  return json(200, headers, { ok: true, notified });
}

// Entry point when running on the Supabase Edge runtime; the guard lets the
// same file be imported for tests under Node.
declare const Deno: { serve?: (h: (req: Request) => Promise<Response>) => void; env: { get: (k: string) => string | undefined } };
if (typeof Deno !== 'undefined' && Deno.serve) {
  Deno.serve((req: Request) => handle(req, (k: string) => Deno.env.get(k)));
}
