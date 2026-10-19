/*
 * POST /api/chat – optional AI answers for the website receptionist chat.
 *
 * OFF unless BOTH are set on the amiri-receptionist-api Worker:
 *   - an "ai" binding named AI (Cloudflare Workers AI), and
 *   - the variable AI_CHAT_ENABLED = "true".
 * While off it answers 404 and the chat uses its built-in answers instead.
 *
 * Workers AI has a free daily allowance; on the Workers Free plan requests
 * beyond it fail (the chat then falls back to its built-in answers) rather
 * than being charged. See AI_RECEPTIONIST_PLAN.md before switching it on.
 *
 * The model only answers general questions. It is told the business facts and
 * the rules (no prices, bookings, availability or qualifications; safety first),
 * and its reply is checked again here before it is shown.
 */
import { SYSTEM_PROMPT, guardReply, cleanHistory } from '../../lib/receptionist.js';

const MODEL = '@cf/meta/llama-3.1-8b-instruct';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestPost({ request, env }) {
  if (env.AI_CHAT_ENABLED !== 'true' || !env.AI) return json(404, { ok: false, error: 'not_found' });

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(400, { ok: false, error: 'bad_request' });
  }
  const messages = cleanHistory(body && body.messages);
  if (!messages.length || messages[messages.length - 1].role !== 'user') return json(400, { ok: false, error: 'bad_request' });

  try {
    const out = await env.AI.run(env.AI_CHAT_MODEL || MODEL, {
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 300,
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
