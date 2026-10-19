/*
 * Worker "amiri-website": the website (static files in dist/) plus two small routes.
 *
 *   POST /api/chat  – AI answers for the "Ask us" chat (functions/api/chat.js)
 *   /admin…         – private enquiry tracker (lib/admin.js)
 *
 * Only /api/* and /admin* reach this code (run_worker_first in wrangler.jsonc);
 * every other request is served straight from the static files, as before.
 * Enquiries themselves still go to the amiri-receptionist-api Worker.
 */
import * as chat from '../functions/api/chat.js';
import { handleAdmin } from '../lib/admin.js';

const notFound = () => new Response(JSON.stringify({ ok: false, error: 'not_found' }), {
  status: 404, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    if (path === '/admin' || path.startsWith('/admin/')) {
      if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
        url.protocol = 'https:';
        return Response.redirect(url.toString(), 301);
      }
      return handleAdmin(request, env);
    }
    if (path === '/api/chat') {
      return request.method === 'POST' ? chat.onRequestPost({ request, env }) : chat.onRequest();
    }
    if (path.startsWith('/api/')) return notFound();
    return env.ASSETS.fetch(request);
  }
};
