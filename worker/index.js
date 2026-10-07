/*
 * Worker entry for the Cloudflare Worker "amiri-website" (static assets + enquiry API).
 *
 * The site is deployed as a Worker with static assets (Workers Builds), not a Pages
 * project, so Pages Functions in functions/ don't run on their own. This file routes
 * /api/* to the same handlers; everything else is served from dist/ by the assets
 * layer before this code runs (see "run_worker_first" in wrangler.jsonc).
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
    const route = routes[url.pathname.replace(/\/+$/, '')];
    const handler = route && (route[request.method] || route['*']);
    if (!handler) return env.ASSETS.fetch(request);
    if (env.ENQUIRY_API_ENABLED !== 'true') return new Response('Not found', { status: 404 });
    const secret = await fileLinkSecret(env);
    return handler({ request, env: { ...env, FILE_LINK_SECRET: secret }, waitUntil: (p) => ctx.waitUntil(p) });
  }
};

// FILE_LINK_SECRET signs photo links and the rate-limit hash. A Worker secret wins;
// otherwise one random value is generated once and kept in D1 (private), so the
// owner doesn't have to create it by hand.
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
