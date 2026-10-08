/*
 * Worker "amiri-receptionist-api": the AI Receptionist back end, kept separate from
 * the website Worker so the live site is never touched.
 *
 *   POST /api/enquiry       – receive an enquiry with photos/video (functions/api/enquiry.js)
 *   GET  /api/enquiry-file  – open one stored photo via a signed, expiring link
 *   everything else         – a test copy of the website with the chat switched on
 *                             (noindex), so the whole flow can be tried before go-live
 *
 * Only pages on this Worker and the origins in ALLOWED_ORIGINS may submit enquiries.
 */
import * as enquiry from '../functions/api/enquiry.js';
import * as enquiryFile from '../functions/api/enquiry-file.js';

const routes = {
  '/api/enquiry': { POST: enquiry.onRequestPost, '*': enquiry.onRequest },
  '/api/enquiry-file': { GET: enquiryFile.onRequestGet }
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
    const secret = await fileLinkSecret(env);
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

// FILE_LINK_SECRET signs photo links and the rate-limit hash. A Worker secret wins;
// otherwise one random value is generated once and kept in D1 (private).
let cached;
async function fileLinkSecret(env) {
  if (env.FILE_LINK_SECRET) return env.FILE_LINK_SECRET;
  if (cached || !env.DB) return cached;
  const fresh = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('FILE_LINK_SECRET', ?1)").bind(fresh).run();
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'FILE_LINK_SECRET'").first();
  cached = row && row.value;
  return cached;
}
