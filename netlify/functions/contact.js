// Contact form relay: receives a submission from the website and posts it
// to Slack. The Slack webhook URL stays server-side in the SLACK_WEBHOOK_URL
// environment variable — it must never appear in the public repo or page,
// since leaked webhook URLs are auto-revoked by Slack's secret scanning.

// Origins allowed to call this function from a browser.
const ALLOWED = (origin) =>
  origin === 'https://zappa36.github.io' ||
  /^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(origin) ||
  /^http:\/\/localhost(:\d+)?$/.test(origin);

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED(origin) ? origin : 'https://zappa36.github.io',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
});

// Slack mrkdwn requires these three escapes.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const reply = (statusCode, headers, body) => ({ statusCode, headers, body: JSON.stringify(body) });

exports.handler = async (event) => {
  const headers = corsHeaders((event.headers && (event.headers.origin || event.headers.Origin)) || '');

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, headers, { error: 'Method not allowed' });
  if ((event.body || '').length > 10000) return reply(413, headers, { error: 'Payload too large' });

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch {
    return reply(400, headers, { error: 'Invalid JSON' });
  }

  // Honeypot: the "website" field is invisible to humans. Bots fill it in;
  // pretend success so they don't adapt.
  if (data.website) return reply(200, headers, { ok: true });

  const name = String(data.name || '').trim().slice(0, 200);
  const email = String(data.email || '').trim().slice(0, 200);
  const company = String(data.company || '').trim().slice(0, 200);
  const message = String(data.message || '').trim().slice(0, 2000);

  if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return reply(400, headers, { error: 'Name, a valid email, and a message are required' });
  }

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return reply(500, headers, { error: 'Relay not configured' });

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
  });

  if (!slackRes.ok) return reply(502, headers, { error: 'Delivery failed' });
  return reply(200, headers, { ok: true });
};
