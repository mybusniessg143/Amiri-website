/*
 * GET /api/enquiry-file?k=…&e=…&s=… – opens one stored enquiry photo/video.
 *
 * Links are signed with FILE_LINK_SECRET and expire (30 days), and are only
 * ever sent to the business email. The R2 bucket itself stays private.
 */
import { verifyFileUrl } from '../../lib/enquiry.js';

export async function onRequestGet({ request, env }) {
  if (env.ENQUIRY_API_ENABLED !== 'true' || !env.ENQUIRY_FILES) return new Response('Not found', { status: 404 });
  const q = new URL(request.url).searchParams;
  const key = q.get('k');
  if (!(await verifyFileUrl(key, q.get('e'), q.get('s'), env.FILE_LINK_SECRET))) {
    return new Response('This link has expired or is not valid.', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const obj = await env.ENQUIRY_FILES.get(key);
  if (!obj) return new Response('File not found (it may have been deleted after 12 months).', { status: 404 });
  const type = (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream';
  const safeType = /^(image|video)\//.test(type) && type !== 'image/svg+xml' ? type : 'application/octet-stream';
  return new Response(obj.body, {
    headers: {
      'Content-Type': safeType,
      'Content-Disposition': `inline; filename="${key.split('/').pop()}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
