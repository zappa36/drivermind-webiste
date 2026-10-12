// Otto sandbox replies — Supabase Edge Function.
//
// Flow: try-otto.html → this function → Claude → one JSON reply
// {say, suggestions, record, end} that the page speaks and files. The page
// falls back to its script on any error, so a failure here only costs the
// visitor the live replies, never the demo.
//
// The prompts live here, not in the page: the browser only names a scenario
// and sends the conversation, so the endpoint can't be used as a general
// Claude proxy. Keep SCENARIOS in step with the openings and ledgers in
// try-otto.html.
//
// Secrets: ANTHROPIC_API_KEY must be set in Edge Function secrets. Optional:
// OTTO_MODEL overrides the model.
//
// Deploy with JWT verification disabled (public page, no logged-in user):
//   dashboard: uncheck "Enforce JWT verification"  ·  CLI: --no-verify-jwt

type Env = (key: string) => string | undefined;

// Only the slice of the Anthropic client this function uses, so tests can
// pass a stub without loading the SDK.
export type Client = {
  beta: { messages: { create: (params: Record<string, unknown>) => Promise<{ stop_reason: string | null; content: { type: string; text?: string }[] }> } };
};

const ALLOWED = (origin: string) =>
  /^https:\/\/(www\.)?parcelvox\.com$/.test(origin) ||
  origin === 'https://zappa36.github.io' ||
  /^http:\/\/localhost(:\d+)?$/.test(origin);

const cors = (origin: string) => ({
  'Access-Control-Allow-Origin': ALLOWED(origin) ? origin : 'https://parcelvox.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
});

const json = (status: number, headers: Record<string, string>, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers });

const CARRIER = 'Kiezpost';
const DRV = 'Ayşe';
const MAX_TURNS = 12;      // visitor + Otto lines after the opening
const MAX_CHARS = 400;     // per line, same as the page's input

type Scenario = { brief: string; who: string; rules: string; known: string; opening: string; ids: Record<string, string> };

const SCENARIOS: Record<string, Scenario> = {
  report: {
    brief: 'In-cab, hands-free. You briefed the driver on the way in to Kollwitzstraße 18 (stop 12). Now the driver tells you what they found at the door. Ask at most two short follow-up questions if the tip is unclear (which door, which side, every day or just today), then file it against the address and confirm in one sentence that the next driver will hear it.',
    who: `the driver, ${DRV}, who has just been to the door at Kollwitzstraße 18`,
    rules: "Keep tips concrete and short enough to read aloud in one breath. Only file what helps the next driver. Don't ask for anything the order already has. If the driver says nothing new, thank them and end.",
    known: [
      'From the order: Consignee — M. Keller; Instructions — Hand over in person; Preferences — Side entrance, not the shop',
      'From earlier drivers: Access — Road closed at the north end — park on Sredzkistraße, walk 2 min',
      'From the office: Customer call — Home until 12:00 today',
    ].join('\n'),
    opening: "Kollwitzstraße 18, two minutes out. From the order: consignee M. Keller, hand over in person, use the side entrance. Earlier drivers say the road's closed at the north end — park on Sredzkistraße and walk in. The office added this morning: Keller's home until twelve. When you've been to the door, tell me what you found.",
    ids: {
      found: 'the tip for the next driver, as filed (what was found at the door)',
      filed: 'when it was filed and who hears it, e.g. "Today 17:42 · next driver hears it on the way in"',
    },
  },
  customer: {
    brief: "Outbound call to the customer before the van arrives. Confirm someone will be home for today's planned 14:00–16:00 delivery; if not, agree a time within the rules. Then confirm what the driver will do and end the call.",
    who: 'the customer, T. Brandt, at Rykestraße 12',
    rules: 'Call window 08:00–20:00. Offer: same day after 17:00 if the route allows, otherwise next day 10:00–12:00 or 14:00–16:00. Signature required: hand over in person. Leave with a neighbour only if the customer names one (name and flat). No safe-place drops. Max 2 reschedules per parcel. Never promise an exact minute.',
    known: [
      'Your rules: Call window — 08:00–20:00; Offer — Same day after 17:00 if the route allows, else next day; Handover — In person — signature required; Neighbours — Only if the customer names one; Reschedules — Max 2 per parcel',
      `From the order: Consignee — T. Brandt; Planned — Today 14:00–16:00; Driver — ${DRV} · route 12`,
    ].join('\n'),
    opening: `Hello, this is Otto calling for ${CARRIER}. I've got a parcel for you today — ${DRV} is planned between two and four and it needs a signature. Will someone be home?`,
    ids: {
      home: 'whether someone is home and from when',
      time: 'the agreed delivery time',
      handover: 'how the parcel is handed over',
      note: 'one line for the driver, e.g. "Brandt · home after six — hand over in person"',
    },
  },
  office: {
    brief: 'You called the office for a stuck driver with the problem pre-filled. Get the answer (new code or move on) and a fallback if it fails, confirm you will relay it to the driver right away, and say what goes on file for the address. Then end.',
    who: 'the dispatcher in the office',
    rules: "Permanent facts (gate codes, access, opening hours) go on file for the address so the next driver hears them. One-off instructions (leave at the shop today) go to the driver only. Don't argue; take the office's decision.",
    known: `Pre-filled by Otto: Driver — ${DRV} · route 12 · van 07; Stop — 19 of 41 · Kollwitzstraße 48; Consignee — Weber · signature required; Problem — Gate code 2290 refused, no answer on the buzzer; Tried — Code ×2, buzzer ×2, 6 min waiting; Asks — New code, or move on?`,
    opening: `Otto here for ${DRV} on route 12. She's at Kollwitzstraße 48, stop 19, a parcel for Weber with signature. The gate code on file, 2290, is refused and nobody answers the buzzer. She's tried both twice and waited six minutes. Do you have a new code, or should she move on?`,
    ids: {
      answer: "the office's answer",
      fallback: 'what the driver should do if it still fails',
      relay: 'what you told the driver and when',
      filed: 'what is now on file for the address (permanent facts only)',
    },
  },
  checkin: {
    brief: 'Outbound check-in to the driver, triggered by the office, with exactly one reason: Kollwitzstraße 71 (stop 23) is away until tomorrow, skip it today. Confirm the driver heard it, take anything they want passed back to the office, and end quickly so they can drive.',
    who: `the driver, ${DRV}, on route 12, pulled over at the roadside`,
    rules: "One reason per call; don't add other topics. Under 20 seconds of talking. Anything the driver says goes back to the office as said, no judgement. If the driver raises a new problem, say you'll pass it on — don't solve it on this call.",
    known: 'Trigger: Triggered by — Office · 11:04; Reason — Kollwitzstraße 71 — customer called, away until tomorrow; Rules — One reason per call · only while the van is stopped · retry after 10 min if no answer',
    opening: `${DRV}, Otto — one thing from the office. The customer at Kollwitzstraße 71 is away until tomorrow, so skip that stop today; it's re-planned for tomorrow. Anything you want me to pass back?`,
    ids: {
      confirmed: 'whether the driver confirmed the instruction, and when',
      back: 'what the driver asked you to pass back to the office',
      route: 'the route change as applied',
    },
  },
};

export function systemPrompt(sc: Scenario, time: string): string {
  const ids = Object.keys(sc.ids).map((k) => `"${k}": ${sc.ids[k]}`).join('; ');
  return `You are Otto, the voice of ParcelVox, working for the parcel carrier ${CARRIER}. You talk like an experienced dispatcher, not a system: plain, sharp, on the driver's side. Spoken language, sentence case, no emoji, no lists, no corporate words (seamless, optimize, AI-powered). Speak as "I". At most two short sentences per turn, under 40 words. Ask at most one question per turn. Never invent facts or rules beyond what you are given; if asked something you don't know, say you'll check and pass it on. If the person drifts off topic, steer back once, then wrap up politely.
This is a demo call on the ParcelVox website; the person on the line is a visitor playing a role. Stay in character as Otto and stay on this call's job.
Current time: ${time}. Driver on this route: ${DRV}.
Situation: ${sc.brief}
You are talking to: ${sc.who}.
Rules you follow: ${sc.rules}
What you already know:
${sc.known}
You opened the call with: "${sc.opening}"
Reply with one JSON object:
- "say": your next spoken line.
- "suggestions": 2 or 3 plausible next replies from the person you're talking to, in their voice, 3 to 9 words each. Empty when "end" is true.
- "record": notes for the office or the next driver, keyed by these ids — ${ids}. Fill an id only once that information is settled in the conversation; leave the others as "". Values are short, sentence case, under 12 words; times as HH:MM.
- "end": true once the job is done. "say" is then your closing line: what you will do next, then a short goodbye.`;
}

export function replySchema(sc: Scenario) {
  const keys = Object.keys(sc.ids);
  return {
    type: 'object',
    properties: {
      say: { type: 'string' },
      suggestions: { type: 'array', items: { type: 'string' } },
      record: {
        type: 'object',
        properties: Object.fromEntries(keys.map((k) => [k, { type: 'string' }])),
        required: keys,
        additionalProperties: false,
      },
      end: { type: 'boolean' },
    },
    required: ['say', 'suggestions', 'record', 'end'],
    additionalProperties: false,
  };
}

export async function handle(req: Request, env: Env, client: Client | null): Promise<Response> {
  const headers = cors(req.headers.get('origin') || '');

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return json(405, headers, { error: 'Method not allowed' });
  if (!client) return json(500, headers, { error: 'Otto not configured' });

  const raw = await req.text();
  if (raw.length > 10000) return json(413, headers, { error: 'Payload too large' });

  let data: { scenario?: unknown; turns?: unknown; time?: unknown };
  try {
    data = JSON.parse(raw || '{}');
  } catch {
    return json(400, headers, { error: 'Invalid JSON' });
  }

  const sc = SCENARIOS[String(data.scenario)];
  if (!sc) return json(400, headers, { error: 'Unknown scenario' });

  // The conversation after Otto's opening: visitor first, then alternating,
  // ending on the visitor's latest line.
  const turns = Array.isArray(data.turns) ? data.turns : [];
  if (!turns.length || turns.length > MAX_TURNS || turns.length % 2 === 0) {
    return json(400, headers, { error: 'Bad conversation' });
  }
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i] as { who?: unknown; text?: unknown };
    const want = i % 2 === 0 ? 'you' : 'otto';
    const text = String(t?.text ?? '').trim();
    if (t?.who !== want || !text || text.length > MAX_CHARS) return json(400, headers, { error: 'Bad conversation' });
    messages.push({ role: want === 'you' ? 'user' : 'assistant', content: text });
  }

  const time = /^\d{1,2}:\d{2}$/.test(String(data.time)) ? String(data.time) : new Date().toISOString().slice(11, 16);

  let res;
  try {
    res = await client.beta.messages.create({
      model: env('OTTO_MODEL') || 'claude-opus-5-5',
      max_tokens: 4000,
      // a short spoken line, not a hard problem: keep thinking light for speed
      output_config: { effort: 'low', format: { type: 'json_schema', schema: replySchema(sc) } },
      // a classifier decline re-runs on the recommended fallback model
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: systemPrompt(sc, time),
      messages,
    });
  } catch (e) {
    console.error('otto: Claude request failed', e);
    return json(502, headers, { error: 'Otto is unavailable' });
  }
  if (res.stop_reason === 'refusal') return json(502, headers, { error: 'Otto declined' });

  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text || '').join('');
  let reply: { say?: unknown; suggestions?: unknown; record?: Record<string, unknown>; end?: unknown };
  try {
    reply = JSON.parse(text);
  } catch {
    return json(502, headers, { error: 'Otto replied out of shape' });
  }
  const say = String(reply.say ?? '').trim();
  if (!say) return json(502, headers, { error: 'Otto replied out of shape' });

  const record: Record<string, string> = {};
  for (const k of Object.keys(sc.ids)) {
    const v = String(reply.record?.[k] ?? '').trim();
    if (v) record[k] = v.slice(0, 160);
  }
  const end = reply.end === true;
  const suggestions = end || !Array.isArray(reply.suggestions)
    ? []
    : reply.suggestions.map((s) => String(s).trim()).filter(Boolean).slice(0, 3);

  return json(200, headers, { say, suggestions, record, end });
}

// Entry point when running on the Supabase Edge runtime; the guard lets the
// same file be imported for tests under Node.
declare const Deno: { serve?: (h: (req: Request) => Promise<Response>) => void; env: { get: (k: string) => string | undefined } };
if (typeof Deno !== 'undefined' && Deno.serve) {
  const env = (k: string) => Deno.env.get(k);
  const { default: Anthropic } = await import('npm:@anthropic-ai/sdk');
  const client = env('ANTHROPIC_API_KEY') ? (new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') }) as unknown as Client) : null;
  Deno.serve((req: Request) => handle(req, env, client));
}
