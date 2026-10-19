/*
 * Shared logic for the AI Receptionist enquiry back end (Cloudflare Pages
 * Functions in functions/api/). Plain JavaScript with no dependencies so it
 * runs on Cloudflare and can be tested with Node.
 *
 * Nothing here holds a secret: keys come from Cloudflare environment
 * variables (see AI_RECEPTIONIST_PLAN.md, "Automatic submission").
 */

export const SERVICES = ['Electrical', 'Plumbing', 'Property Maintenance', 'Other'];
export const URGENCIES = ['Emergency', 'Urgent', 'Planned'];
export const URGENCY_LABEL = { Emergency: 'EMERGENCY', Urgent: 'URGENT', Planned: 'Planned / non-emergency' };
export const WHEN = ['As soon as possible', 'In the next few days', 'In the next 2 weeks', "I'm flexible"];

export const LIMITS = {
  files: 6,
  photoBytes: 15 * 1024 * 1024,
  videoBytes: 60 * 1024 * 1024,
  totalBytes: 90 * 1024 * 1024,          // Cloudflare's request limit is 100 MB on the free plan
  emailAttachBytes: 18 * 1024 * 1024,    // photos above this total are sent as links only
  perIpPerHour: 5
};

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp', 'video/x-m4v'];

/* ------------------------------------------------------------ validation */

export function normPostcode(v) {
  const m = String(v || '').toUpperCase().replace(/\s+/g, '').match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  return m ? `${m[1]} ${m[2]}` : null;
}

export function normPhone(v) {
  const d = String(v || '').replace(/[\s()-]/g, '');
  if (/^\+44\d{9,10}$/.test(d)) return d;
  if (/^07\d{9}$/.test(d)) return `${d.slice(0, 5)} ${d.slice(5)}`;
  if (/^0\d{9,10}$/.test(d)) return d;
  return null;
}

/** E.164-ish digits for tel:/wa.me links, e.g. 447700900456. */
export function phoneDigits(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.startsWith('0') ? `44${d.slice(1)}` : d;
}

function clean(v, max) {
  // Strip control characters (keep new lines in descriptions), trim, cap length.
  return String(v == null ? '' : v).replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
}

/**
 * Validates the text fields of a submission.
 * @returns {{ ok: true, enquiry: object } | { ok: false, errors: string[] }}
 */
export function validateFields(get) {
  const errors = [];
  const e = {
    service: clean(get('service'), 40),
    urgency: clean(get('urgency'), 20),
    postcode: normPostcode(get('postcode')),
    description: clean(get('description'), 1000),
    name: clean(get('name'), 80),
    phone: normPhone(get('phone')),
    when: clean(get('when'), 40),
    availability: clean(get('availability'), 200),
    page: clean(get('page'), 200)
  };
  if (!SERVICES.includes(e.service)) errors.push('service');
  if (!URGENCIES.includes(e.urgency)) errors.push('urgency');
  if (!e.postcode) errors.push('postcode');
  if (e.description.length < 5) errors.push('description');
  if (e.name.length < 2) errors.push('name');
  if (!e.phone) errors.push('phone');
  if (!WHEN.includes(e.when)) errors.push('when');
  if (get('consent') !== 'yes') errors.push('consent');
  if (clean(get('website'), 200)) errors.push('spam');   // honeypot field, hidden from people
  return errors.length ? { ok: false, errors } : { ok: true, enquiry: e };
}

/**
 * Checks uploaded files. Returns the accepted files and any problems.
 * Files whose type is not a photo or video are rejected, never stored.
 */
export function validateFiles(files) {
  const accepted = [];
  const problems = [];
  let total = 0;
  for (const f of files) {
    if (!f || typeof f.arrayBuffer !== 'function' || !f.size) continue;
    const type = String(f.type || '').toLowerCase();
    const isPhoto = PHOTO_TYPES.includes(type);
    const isVideo = VIDEO_TYPES.includes(type);
    if (!isPhoto && !isVideo) { problems.push(`${f.name}: not a photo or video`); continue; }
    if (isPhoto && f.size > LIMITS.photoBytes) { problems.push(`${f.name}: photo too large`); continue; }
    if (isVideo && f.size > LIMITS.videoBytes) { problems.push(`${f.name}: video too large`); continue; }
    if (accepted.length >= LIMITS.files) { problems.push(`${f.name}: too many files`); continue; }
    if (total + f.size > LIMITS.totalBytes) { problems.push(`${f.name}: upload too large`); continue; }
    total += f.size;
    accepted.push({ file: f, kind: isPhoto ? 'photo' : 'video', type });
  }
  return { accepted, problems };
}

/* ------------------------------------------------------------- helpers */

export function makeReference(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const buf = new Uint8Array(3);
  crypto.getRandomValues(buf);
  const rand = String(((buf[0] << 16) | (buf[1] << 8) | buf[2]) % 9000 + 1000);
  return `ABS-${p(date.getUTCDate())}${p(date.getUTCMonth() + 1)}${String(date.getUTCFullYear()).slice(2)}-${rand}`;
}

export function safeFileName(name, i, type) {
  const ext = (String(name).match(/\.([a-z0-9]{2,5})$/i) || [])[1] || (type.split('/')[1] || 'bin');
  const base = String(name).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'file';
  return `${String(i + 1).padStart(2, '0')}-${base}.${ext.toLowerCase()}`;
}

const enc = new TextEncoder();
function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/** Signed, expiring link to a stored file (served by functions/api/enquiry-file.js). */
export async function signFileUrl(origin, key, secret, days = 30, now = Date.now()) {
  const exp = Math.floor(now / 1000) + days * 86400;
  const sig = await hmac(secret, `${key}|${exp}`);
  return `${origin}/api/enquiry-file?k=${encodeURIComponent(key)}&e=${exp}&s=${sig}`;
}

export async function verifyFileUrl(key, exp, sig, secret, now = Date.now()) {
  if (!key || !exp || !sig || !secret) return false;
  if (!/^enquiries\/ABS-\d{6}-\d{4}\/[\w.-]+$/.test(key)) return false;
  if (Number(exp) < Math.floor(now / 1000)) return false;
  const expected = await hmac(secret, `${key}|${exp}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export async function hashIp(ip, secret) {
  return (await hmac(secret || 'amiri', `ip|${ip || ''}`)).slice(0, 22);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function ukTime(iso) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'short' }).format(new Date(iso));
  } catch (e) {
    return iso;
  }
}

/* ---------------------------------------------------------------- email */

/**
 * Builds the job summary email sent to the business.
 * @param {object} e  validated enquiry + { reference, createdAt }
 * @param {Array<{name, kind, size, url}>} files  stored files with signed links
 */
export function buildEmail(e, files) {
  const label = URGENCY_LABEL[e.urgency];
  const prefix = e.urgency === 'Planned' ? 'New enquiry' : label;
  const subject = `${prefix}: ${e.service} – ${e.name}, ${e.postcode} (${e.reference})`;
  const when = e.availability ? `${e.when} – ${e.availability}` : e.when;
  const photos = files.filter((f) => f.kind === 'photo').length;
  const videos = files.filter((f) => f.kind === 'video').length;
  const filesLine = files.length
    ? [photos && `${photos} photo${photos > 1 ? 's' : ''}`, videos && `${videos} video${videos > 1 ? 's' : ''}`].filter(Boolean).join(' and ')
    : 'None';
  const rows = [
    ['Reference', e.reference],
    ['Received', ukTime(e.createdAt)],
    ['Urgency', label],
    ['Service', e.service],
    ['Name', e.name],
    ['Phone', e.phone],
    ['Postcode', e.postcode],
    ['Problem', e.description],
    ['When', when],
    ['Photos / video', filesLine]
  ];
  const tel = `tel:+${phoneDigits(e.phone)}`;
  const wa = `https://wa.me/${phoneDigits(e.phone)}?text=${encodeURIComponent(`Hello ${e.name.split(' ')[0]}, this is Amiri Building Services about your enquiry ${e.reference}.`)}`;

  const text = [
    `${prefix.toUpperCase()} – website enquiry ${e.reference}`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    files.length ? 'Photos and video (links work for 30 days; photos are also attached):' : '',
    ...files.map((f) => `- ${f.name} (${f.kind}, ${fmtSize(f.size)}): ${f.url}`),
    files.length ? '' : '',
    `Call the customer: ${e.phone}`,
    `WhatsApp the customer: ${wa}`,
    '',
    'The customer agreed to us using these details and photos to respond to their enquiry.',
    'Sent automatically by the website enquiry assistant. No price or booking has been promised.'
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');

  const urgentColour = e.urgency === 'Planned' ? '#2a2d33' : '#8a6a26';
  const html = `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f0e8;font-family:Arial,Helvetica,sans-serif;color:#1b1e23;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f0e8;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5ddcf;">
<tr><td style="background:#121417;padding:20px 24px;border-bottom:3px solid #c9a14f;">
  <div style="color:#e3c88c;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:bold;">Amiri Building Services · Website enquiry</div>
  <div style="color:#ffffff;font-size:22px;font-weight:bold;margin-top:6px;">${esc(prefix === 'New enquiry' ? 'New enquiry' : `${label} enquiry`)}: ${esc(e.service)}</div>
  <div style="color:#b4aea4;font-size:14px;margin-top:4px;">${esc(e.reference)} · ${esc(e.postcode)}</div>
</td></tr>
${e.urgency !== 'Planned' ? `<tr><td style="background:#fbf3df;padding:12px 24px;color:${urgentColour};font-weight:bold;font-size:15px;border-bottom:1px solid #e5ddcf;">${e.urgency === 'Emergency' ? 'Emergency: the customer says something is unsafe or causing damage now. Please call them back first.' : 'Urgent: the customer needs this looked at soon.'}</td></tr>` : ''}
<tr><td style="padding:20px 24px 8px;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="padding-right:8px;"><a href="${esc(tel)}" style="display:inline-block;background:#c9a14f;color:#0b0c0e;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:10px;">Call ${esc(e.name.split(' ')[0])}: ${esc(e.phone)}</a></td>
    <td><a href="${esc(wa)}" style="display:inline-block;background:#1c7a5e;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:10px;">WhatsApp</a></td>
  </tr></table>
</td></tr>
<tr><td style="padding:8px 24px 4px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:15px;">
  ${rows.map(([k, v]) => `<tr><td style="padding:10px 12px 10px 0;border-top:1px solid #efe8db;color:#5b6069;width:130px;vertical-align:top;">${esc(k)}</td><td style="padding:10px 0;border-top:1px solid #efe8db;font-weight:bold;vertical-align:top;white-space:pre-line;${k === 'Urgency' && e.urgency !== 'Planned' ? `color:${urgentColour};` : ''}">${esc(v)}</td></tr>`).join('\n  ')}
  </table>
</td></tr>
${files.length ? `<tr><td style="padding:16px 24px 4px;">
  <div style="font-weight:bold;font-size:15px;margin-bottom:6px;">Photos and video</div>
  <div style="color:#5b6069;font-size:13px;margin-bottom:8px;">Photos are attached to this email. Every file is also stored securely; these links work for 30 days.</div>
  ${files.map((f) => `<div style="padding:6px 0;font-size:14px;"><a href="${esc(f.url)}" style="color:#8a6a26;font-weight:bold;">${esc(f.name)}</a> <span style="color:#5b6069;">(${f.kind}, ${fmtSize(f.size)})</span></div>`).join('\n  ')}
</td></tr>` : ''}
<tr><td style="padding:18px 24px 22px;color:#5b6069;font-size:12px;line-height:1.5;border-top:1px solid #efe8db;">
  The customer agreed to us using these details and photos to respond to their enquiry. Sent automatically by the website enquiry assistant. No price or booking has been promised to the customer.
</td></tr>
</table></td></tr></table>
</body></html>`;
  return { subject, text, html };
}

/** Short WhatsApp alert to the business (template parameters, in order). */
export function whatsappAlertParams(e) {
  return [URGENCY_LABEL[e.urgency], e.service, e.postcode, e.reference];
}
