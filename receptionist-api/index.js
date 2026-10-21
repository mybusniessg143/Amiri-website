/*
 * Worker "amiri-receptionist-api": the AI Receptionist back end, kept separate from
 * the website Worker so the live site is never touched.
 *
 *   POST /api/enquiry       – receive an enquiry with photos/video (functions/api/enquiry.js)
 *   GET  /api/enquiry-file  – open one stored photo via a signed, expiring link
 *   POST /api/chat          – optional AI answers for the chat (off unless AI_CHAT_ENABLED and an AI binding)
 *   everything else         – a test copy of the website with the chat switched on
 *                             (noindex), so the whole flow can be tried before go-live
 *
 * Only pages on this Worker and the origins in ALLOWED_ORIGINS may submit enquiries.
 * Workers Builds deploys this Worker automatically from main (see wrangler.jsonc).
 */
import * as enquiry from '../functions/api/enquiry.js';
import * as enquiryFile from '../functions/api/enquiry-file.js';
import * as chat from '../functions/api/chat.js';
import { linkSecret } from '../lib/limits.js';

const routes = {
  '/api/enquiry': { POST: enquiry.onRequestPost, '*': enquiry.onRequest },
  '/api/enquiry-file': { GET: enquiryFile.onRequestGet },
  '/api/chat': { POST: chat.onRequestPost, '*': chat.onRequest }
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const route = routes[path];

    if (!route) {
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return out;
    }

    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    }
    if (env.ENQUIRY_API_ENABLED !== 'true') return new Response('Not found', { status: 404 });

    const handler = route[request.method] || route['*'];
    const secret = await linkSecret(env);
    const res = await handler({ request, env: { ...env, FILE_LINK_SECRET: secret }, waitUntil: (p) => ctx.waitUntil(p) });
    if (!cors) return res;
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  }
};

// CORS only for the website's own origins (ALLOWED_ORIGINS, comma-separated).
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}
