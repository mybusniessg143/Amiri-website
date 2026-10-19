/*
 * POST /api/chat – AI answers for the website receptionist chat.
 *
 * Runs on the website Worker (worker/index.js) and needs:
 *   - an "ai" binding named AI (Cloudflare Workers AI),
 *   - the D1 binding DB (for the daily limits below), and
 *   - the variable AI_CHAT_ENABLED = "true".
 * Without any of them it answers 404/503 and the chat uses its built-in answers.
 *
 * Cost: Workers AI includes 10,000 neurons a day free. The limits here keep usage
 * well inside that, so it never costs anything on either Workers plan:
 *   AI_DAILY_LIMIT    answers a day for the whole site (default 60, about 6,000 neurons at most)
 *   AI_IP_DAILY_LIMIT answers a day for one visitor (default 15)
 * When a limit is reached the chat quietly falls back to its built-in answers.
 *
 * The model only answers general questions. It is told the business facts and
 * the rules (no prices, bookings, availability or qualifications; safety first),
 * and its reply is checked again here before it is shown. Chat text is not stored.
 */
import { SYSTEM_PROMPT, guardReply, cleanHistory } from '../../lib/receptionist.js';
import { hashIp } from '../../lib/enquiry.js';
import { bump, tidy, linkSecret } from '../../lib/limits.js';

// Worst case per answer: ~2,100 input tokens and 220 output tokens, about 100 neurons.
export const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_BODY = 8 * 1024;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestPost({ request, env }) {
  if (env.AI_CHAT_ENABLED !== 'true' || !env.AI) return json(404, { ok: false, error: 'not_found' });
  if (!env.DB) return json(503, { ok: false, error: 'unavailable' });

  // Only the website's own pages may use it, so nobody else spends the daily allowance.
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  if (!origin || (safeHost(origin) !== url.host && !allowed.includes(origin))) return json(403, { ok: false, error: 'forbidden' });
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return json(413, { ok: false, error: 'too_large' });

  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json(413, { ok: false, error: 'too_large' });
    body = JSON.parse(text);
  } catch (e) {
    return json(400, { ok: false, error: 'bad_request' });
  }
  const messages = cleanHistory(body && body.messages);
  if (!messages.length || messages[messages.length - 1].role !== 'user') return json(400, { ok: false, error: 'bad_request' });

  const day = new Date().toISOString().slice(0, 10);
  const ip = await hashIp(request.headers.get('CF-Connecting-IP') || '', await linkSecret(env));
  try {
    const mine = await bump(env.DB, `ai:${day}:${ip}`, day);
    if (mine > limit(env.AI_IP_DAILY_LIMIT, 15)) return json(429, { ok: false, error: 'limit' });
    const all = await bump(env.DB, `ai:${day}:all`, day);
    if (all > limit(env.AI_DAILY_LIMIT, 60)) return json(429, { ok: false, error: 'limit' });
    await tidy(env.DB);
  } catch (err) {
    console.error('chat: usage counter failed', err && err.message);
    return json(503, { ok: false, error: 'unavailable' });
  }

  try {
    const out = await env.AI.run(env.AI_CHAT_MODEL || MODEL, {
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 220,
      temperature: 0.2
    });
    const reply = guardReply(out && (out.response || out.result && out.result.response));
    if (!reply) return json(502, { ok: false, error: 'no_answer' });
    return json(200, { ok: true, reply });
  } catch (err) {
    console.error('chat: model call failed', err && err.message);
    return json(503, { ok: false, error: 'unavailable' });
  }
}

export function onRequest() {
  return json(405, { ok: false, error: 'method_not_allowed' });
}

function limit(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function safeHost(origin) {
  try {
    return new URL(origin).host;
  } catch (e) {
    return '';
  }
}
