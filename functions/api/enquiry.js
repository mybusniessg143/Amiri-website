/*
 * POST /api/enquiry – receives a finished AI Receptionist enquiry.
 *
 * 1. Checks it (same site, honeypot, optional Turnstile, rate limit, fields, files).
 * 2. Saves photos/video to Cloudflare R2 and the enquiry to Cloudflare D1,
 *    so nothing is lost even if an email fails.
 * 3. Emails the job summary (with photos attached and secure links) via Resend.
 * 4. Optionally sends a short WhatsApp alert to the business (WhatsApp Cloud API).
 *
 * Switched off (404) unless the Cloudflare environment variable
 * ENQUIRY_API_ENABLED is "true". Setup: AI_RECEPTIONIST_PLAN.md,
 * "Automatic submission". No secrets live in this file.
 */
import {
  LIMITS, validateFields, validateFiles, makeReference, safeFileName,
  signFileUrl, hashIp, buildEmail, whatsappAlertParams
} from '../../lib/enquiry.js';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestPost({ request, env, waitUntil }) {
  if (env.ENQUIRY_API_ENABLED !== 'true') return json(404, { ok: false, error: 'not_found' });
  if (!env.DB || !env.ENQUIRY_FILES || !env.FILE_LINK_SECRET) return json(503, { ok: false, error: 'not_configured' });

  // Only accept posts from our own pages.
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== url.host) return json(403, { ok: false, error: 'forbidden' });
  if (Number(request.headers.get('Content-Length') || 0) > LIMITS.totalBytes + 5 * 1024 * 1024) {
    return json(413, { ok: false, error: 'too_large' });
  }

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return json(400, { ok: false, error: 'bad_request' });
  }
  const get = (k) => form.get(k);

  // Spam protection: Cloudflare Turnstile when configured.
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (env.TURNSTILE_SECRET_KEY) {
    const ok = await verifyTurnstile(env, get('cf-turnstile-response'), ip);
    if (!ok) return json(400, { ok: false, error: 'spam_check' });
  }

  const checked = validateFields(get);
  if (!checked.ok) {
    // A filled honeypot gets a normal-looking reply so bots learn nothing.
    if (checked.errors.includes('spam')) return json(200, { ok: true, reference: makeReference() });
    return json(400, { ok: false, error: 'invalid', fields: checked.errors });
  }

  const ipHash = await hashIp(ip, env.FILE_LINK_SECRET);
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM enquiries WHERE ip_hash = ?1 AND created_at > datetime('now', '-1 hour')"
  ).bind(ipHash).first();
  if (recent && recent.n >= LIMITS.perIpPerHour) return json(429, { ok: false, error: 'too_many' });

  const e = checked.enquiry;
  e.reference = makeReference();
  e.createdAt = new Date().toISOString();

  // 1. Files → R2 (private bucket).
  const { accepted, problems } = validateFiles(form.getAll('files'));
  const stored = [];
  for (const [i, a] of accepted.entries()) {
    const name = safeFileName(a.file.name, i, a.type);
    const key = `enquiries/${e.reference}/${name}`;
    try {
      await env.ENQUIRY_FILES.put(key, await a.file.arrayBuffer(), {
        httpMetadata: { contentType: a.type },
        customMetadata: { reference: e.reference, kind: a.kind, originalName: String(a.file.name).slice(0, 120) }
      });
      stored.push({ key, name, kind: a.kind, size: a.file.size, type: a.type, file: a.file });
    } catch (err) {
      problems.push(`${a.file.name}: could not be stored`);
    }
  }

  // 2. Enquiry → D1. This is the record of truth.
  let saved = false;
  try {
    await env.DB.prepare(
      `INSERT INTO enquiries (reference, created_at, service, urgency, postcode, description, name, phone,
         when_needed, availability, page, files_json, file_problems, consent_at, ip_hash, user_agent)
       VALUES (?1, datetime('now'), ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, datetime('now'), ?13, ?14)`
    ).bind(
      e.reference, e.service, e.urgency, e.postcode, e.description, e.name, e.phone,
      e.when, e.availability, e.page, JSON.stringify(stored.map(({ file, ...rest }) => rest)), problems.join('; '), ipHash,
      (request.headers.get('User-Agent') || '').slice(0, 200)
    ).run();
    saved = true;
  } catch (err) {
    console.error('enquiry: D1 insert failed', e.reference, err && err.message);
  }

  // 3 + 4. Notify the business.
  const links = await Promise.all(stored.map(async (f) => ({ ...f, url: await signFileUrl(url.origin, f.key, env.FILE_LINK_SECRET) })));
  const [email, whatsapp] = await Promise.all([
    sendEmail(env, e, links).catch((err) => `failed: ${err.message}`.slice(0, 200)),
    sendWhatsApp(env, e).catch((err) => `failed: ${err.message}`.slice(0, 200))
  ]);
  if (saved) {
    const update = env.DB.prepare('UPDATE enquiries SET email_status = ?1, whatsapp_status = ?2 WHERE reference = ?3')
      .bind(email, whatsapp, e.reference).run().catch(() => {});
    if (waitUntil) waitUntil(update); else await update;
  }
  // Housekeeping: enquiries older than 12 months are deleted with their files (privacy notice).
  if (waitUntil) waitUntil(deleteExpired(env).catch(() => {}));

  if (!saved && email !== 'sent') {
    console.error('enquiry: not stored and not emailed', e.reference, email);
    return json(502, { ok: false, error: 'not_delivered' });
  }
  return json(200, { ok: true, reference: e.reference, filesReceived: stored.length, filesRejected: problems.length });
}

export function onRequest() {
  return json(405, { ok: false, error: 'method_not_allowed' });
}

async function deleteExpired(env) {
  const old = "created_at < datetime('now', '-365 days')";
  const { results } = await env.DB.prepare(`SELECT files_json FROM enquiries WHERE ${old} LIMIT 50`).all();
  const keys = (results || []).flatMap((r) => {
    try { return JSON.parse(r.files_json).map((f) => f.key).filter(Boolean); } catch (e) { return []; }
  });
  if (keys.length) await env.ENQUIRY_FILES.delete(keys);
  await env.DB.prepare(`DELETE FROM enquiries WHERE ${old}`).run();
}

async function verifyTurnstile(env, token, ip) {
  if (!token) return false;
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET_KEY);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const data = await r.json().catch(() => ({}));
  return Boolean(data.success);
}

async function sendEmail(env, e, files) {
  if (!env.RESEND_API_KEY || !env.EMAIL_TO || !env.EMAIL_FROM) return 'not_configured';
  const { subject, text, html } = buildEmail(e, files);

  // Attach photos while they fit comfortably; every file is also linked.
  const attachments = [];
  let total = 0;
  for (const f of files) {
    if (f.kind !== 'photo' || total + f.size > LIMITS.emailAttachBytes) continue;
    attachments.push({ filename: f.name, content: toBase64(await f.file.arrayBuffer()), content_type: f.type });
    total += f.size;
  }

  const r = await fetch(env.RESEND_API_URL || 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: env.EMAIL_TO.split(',').map((s) => s.trim()).filter(Boolean),
      subject, text, html, attachments,
      headers: e.urgency === 'Emergency' ? { 'X-Priority': '1', Importance: 'high' } : undefined,
      tags: [{ name: 'type', value: 'website_enquiry' }]
    })
  });
  if (!r.ok) throw new Error(`Resend ${r.status} ${(await r.text()).slice(0, 120)}`);
  return 'sent';
}

async function sendWhatsApp(env, e) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_ALERT_TO) return 'not_configured';
  const base = env.WHATSAPP_API_URL || 'https://graph.facebook.com/v21.0';
  const r = await fetch(`${base}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: env.WHATSAPP_ALERT_TO,
      type: 'template',
      template: {
        name: env.WHATSAPP_TEMPLATE || 'new_enquiry',
        language: { code: env.WHATSAPP_TEMPLATE_LANG || 'en_GB' },
        components: [{ type: 'body', parameters: whatsappAlertParams(e).map((t) => ({ type: 'text', text: t })) }]
      }
    })
  });
  if (!r.ok) throw new Error(`WhatsApp ${r.status} ${(await r.text()).slice(0, 120)}`);
  return 'sent';
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
