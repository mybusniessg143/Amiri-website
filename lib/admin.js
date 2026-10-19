/*
 * /admin – private enquiry tracker on the website Worker (worker/index.js).
 *
 * Lists the enquiries saved in D1, shows each one with its photos (read from the
 * private R2 bucket), lets the business set a status and private notes, and
 * exports a CSV. Nothing here is linked from the website and it is never indexed.
 *
 * Sign-in: the browser asks for a password (HTTP Basic, over HTTPS only). The
 * password is the Worker secret ADMIN_PASSWORD, set by the owner in the Cloudflare
 * dashboard. Until it is set the page is closed. 10 wrong passwords in an hour
 * from one connection lock it out for the rest of that hour.
 *
 * No scripts run on these pages; changes are plain form posts checked against
 * the site's own origin.
 */
import { hashIp } from './enquiry.js';
import { bump, peek, tidy, linkSecret } from './limits.js';

export const STATUSES = ['new', 'contacted', 'quoted', 'booked', 'completed', 'closed'];
const LABEL = { new: 'New', contacted: 'Contacted', quoted: 'Quote sent', booked: 'Booked', completed: 'Completed', closed: 'Closed / not going ahead' };
const OPEN = ['new', 'contacted', 'quoted', 'booked'];
const MAX_FAILS = 10;

const SECURITY = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; media-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000'
};

export async function handleAdmin(request, env) {
  const url = new URL(request.url);
  if (!env.DB) return page(503, 'Not available', '<p>The enquiry database is not connected.</p>');
  if (!env.ADMIN_PASSWORD) {
    return page(503, 'Tracker not switched on',
      '<p>To use this page, add a secret called <code>ADMIN_PASSWORD</code> to the <code>amiri-website</code> Worker in the Cloudflare dashboard (Settings, Variables and Secrets). Use a long password that you do not use anywhere else.</p>');
  }

  const now = new Date();
  const hour = now.toISOString().slice(0, 13);
  const ip = await hashIp(request.headers.get('CF-Connecting-IP') || '', await linkSecret(env));
  const failBucket = `login:${hour}:${ip}`;
  if ((await peek(env.DB, failBucket)) >= MAX_FAILS) {
    return page(429, 'Too many attempts', '<p>Too many wrong passwords. Please try again in an hour.</p>');
  }
  if (!(await passwordOk(request, env.ADMIN_PASSWORD))) {
    if (request.headers.get('Authorization')) await bump(env.DB, failBucket, hour.slice(0, 10));
    await tidy(env.DB, now);
    const res = page(401, 'Sign in', '<p>Please sign in to see enquiries.</p>');
    res.headers.set('WWW-Authenticate', 'Basic realm="Amiri enquiries", charset="UTF-8"');
    return res;
  }

  const path = url.pathname.replace(/\/+$/, '') || '/admin';
  if (request.method === 'POST') {
    if (!sameOrigin(request, url)) return page(403, 'Not allowed', '<p>This change did not come from this page.</p>');
    if (path === '/admin/enquiry') return update(request, env);
    return page(405, 'Not allowed', '');
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return page(405, 'Not allowed', '');
  if (path === '/admin') return list(url, env);
  if (path === '/admin/enquiry') return detail(url, env);
  if (path === '/admin/file') return file(url, env);
  if (path === '/admin/export.csv') return exportCsv(env);
  return page(404, 'Not found', '<p><a href="/admin">Back to enquiries</a></p>');
}

/* ------------------------------------------------------------------ pages */

async function list(url, env) {
  const view = url.searchParams.get('status') || 'open';
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
  const where = [];
  const args = [];
  if (view === 'open') where.push(`status IN (${OPEN.map((s) => `'${s}'`).join(',')})`);
  else if (STATUSES.includes(view)) { args.push(view); where.push(`status = ?${args.length}`); }
  if (q) {
    args.push(`%${q}%`);
    const n = args.length;
    where.push(`(reference LIKE ?${n} OR name LIKE ?${n} OR postcode LIKE ?${n} OR phone LIKE ?${n} OR description LIKE ?${n})`);
  }
  const sql = `SELECT reference, created_at, service, urgency, postcode, name, phone, status, files_json
    FROM enquiries ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`;
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  const counts = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM enquiries GROUP BY status').all();
  const count = Object.fromEntries((counts.results || []).map((r) => [r.status, r.n]));
  const openCount = OPEN.reduce((t, s) => t + (count[s] || 0), 0);

  const tabs = [['open', `Open (${openCount})`], ...STATUSES.map((s) => [s, `${LABEL[s].split(' /')[0]} (${count[s] || 0})`]), ['all', 'All']]
    .map(([v, l]) => `<a class="tab${v === view ? ' on' : ''}" href="/admin?status=${v}">${esc(l)}</a>`).join('');
  const rows = (results || []).map((r) => {
    const files = parseFiles(r.files_json).length;
    return `<a class="card" href="/admin/enquiry?ref=${encodeURIComponent(r.reference)}">
      <span class="top"><b>${esc(r.name)}</b><span class="st st-${esc(r.status)}">${esc(LABEL[r.status] || r.status)}</span></span>
      <span>${esc(r.service)} · <span class="${r.urgency === 'Emergency' ? 'urg' : ''}">${esc(r.urgency)}</span> · ${esc(r.postcode)}${files ? ` · ${files} photo${files > 1 ? 's' : ''}` : ''}</span>
      <span class="muted">${esc(r.reference)} · ${esc(ukTime(r.created_at))}</span></a>`;
  }).join('') || '<p class="muted">No enquiries here.</p>';

  return page(200, 'Enquiries', `
    <form class="search" method="get" action="/admin"><input type="hidden" name="status" value="${esc(view)}">
      <input name="q" value="${esc(q)}" placeholder="Search name, postcode, phone or reference" aria-label="Search"><button>Search</button></form>
    <nav class="tabs">${tabs}</nav>
    <div class="list">${rows}</div>
    <p class="muted"><a href="/admin/export.csv">Download all enquiries (CSV)</a>. Enquiries are deleted automatically after 12 months.</p>`);
}

async function detail(url, env) {
  const ref = url.searchParams.get('ref') || '';
  const r = await env.DB.prepare('SELECT * FROM enquiries WHERE reference = ?1').bind(ref).first();
  if (!r) return page(404, 'Not found', '<p>No enquiry with that reference. <a href="/admin">Back to enquiries</a></p>');
  const files = parseFiles(r.files_json);
  const media = files.map((f) => {
    const src = `/admin/file?ref=${encodeURIComponent(r.reference)}&k=${encodeURIComponent(f.key)}`;
    return /^image\//.test(f.type)
      ? `<a href="${esc(src)}"><img src="${esc(src)}" alt="${esc(f.name)}" loading="lazy"></a>`
      : `<a class="btn" href="${esc(src)}">Open video: ${esc(f.name)}</a>`;
  }).join('');
  const tel = String(r.phone || '').replace(/[^\d+]/g, '');
  const wa = tel.replace(/^\+/, '').replace(/^0/, '44');
  const field = (label, value) => (value ? `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>` : '');
  const options = STATUSES.map((s) => `<option value="${s}"${s === r.status ? ' selected' : ''}>${esc(LABEL[s])}</option>`).join('');

  return page(200, `${r.reference}`, `
    <p><a href="/admin">← All enquiries</a></p>
    ${url.searchParams.get('saved') ? '<p class="ok">Saved.</p>' : ''}
    <h2>${esc(r.name)} <span class="st st-${esc(r.status)}">${esc(LABEL[r.status] || r.status)}</span></h2>
    <p class="actions"><a class="btn" href="tel:${esc(tel)}">Call ${esc(r.phone)}</a>
      <a class="btn" href="https://wa.me/${esc(wa)}">WhatsApp</a>
      ${r.email ? `<a class="btn" href="mailto:${esc(r.email)}?subject=${encodeURIComponent('Your enquiry ' + r.reference)}">Email</a>` : ''}</p>
    <dl>
      ${field('Reference', r.reference)}${field('Received', ukTime(r.created_at))}
      ${field('Service', r.service)}${field('Urgency', r.urgency)}${field('When', r.when_needed)}
      ${field('Postcode', r.postcode)}${field('Address', r.address)}${field('Phone', r.phone)}${field('Email', r.email)}
      ${field('Availability', r.availability)}${field('Sent from page', r.page)}
      ${field('Email to you', r.email_status)}${field('File problems', r.file_problems)}
    </dl>
    <h3>Description</h3><p class="desc">${esc(r.description)}</p>
    ${media ? `<h3>Photos and videos</h3><div class="media">${media}</div>` : ''}
    <h3>Progress</h3>
    <form method="post" action="/admin/enquiry" class="upd">
      <input type="hidden" name="ref" value="${esc(r.reference)}">
      <label>Status <select name="status">${options}</select></label>
      <label>Private notes <textarea name="notes" rows="5" maxlength="4000">${esc(r.notes || '')}</textarea></label>
      <button>Save</button>
      ${r.status_updated_at ? `<span class="muted">Last changed ${esc(ukTime(r.status_updated_at))}</span>` : ''}
    </form>`);
}

async function update(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return page(400, 'Bad request', '');
  }
  const ref = String(form.get('ref') || '');
  const status = String(form.get('status') || '');
  const notes = String(form.get('notes') || '').slice(0, 4000);
  if (!STATUSES.includes(status)) return page(400, 'Bad request', '<p>Unknown status.</p>');
  await env.DB.prepare("UPDATE enquiries SET status = ?1, notes = ?2, status_updated_at = datetime('now') WHERE reference = ?3")
    .bind(status, notes, ref).run();
  return new Response(null, { status: 303, headers: { ...SECURITY, Location: `/admin/enquiry?ref=${encodeURIComponent(ref)}&saved=1` } });
}

async function file(url, env) {
  const ref = url.searchParams.get('ref') || '';
  const key = url.searchParams.get('k') || '';
  const r = await env.DB.prepare('SELECT files_json FROM enquiries WHERE reference = ?1').bind(ref).first();
  // Only files that belong to this enquiry.
  if (!r || !env.ENQUIRY_FILES || !parseFiles(r.files_json).some((f) => f.key === key)) return page(404, 'Not found', '');
  const obj = await env.ENQUIRY_FILES.get(key);
  if (!obj) return page(404, 'Not found', '<p>The file may have been deleted after 12 months.</p>');
  const type = (obj.httpMetadata && obj.httpMetadata.contentType) || '';
  const safeType = /^(image|video)\//.test(type) && type !== 'image/svg+xml' ? type : 'application/octet-stream';
  return new Response(obj.body, {
    headers: { ...SECURITY, 'Content-Type': safeType, 'Content-Security-Policy': 'sandbox', 'Content-Disposition': `inline; filename="${key.split('/').pop().replace(/[^\w.-]/g, '_')}"` }
  });
}

async function exportCsv(env) {
  const cols = ['reference', 'created_at', 'status', 'service', 'urgency', 'name', 'phone', 'email', 'postcode', 'address', 'when_needed', 'availability', 'description', 'notes', 'email_status'];
  const { results } = await env.DB.prepare(`SELECT ${cols.join(', ')} FROM enquiries ORDER BY created_at DESC`).all();
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formulas
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [cols.join(','), ...(results || []).map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
  const day = new Date().toISOString().slice(0, 10);
  return new Response('﻿' + csv, {
    headers: { ...SECURITY, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="amiri-enquiries-${day}.csv"` }
  });
}

/* ---------------------------------------------------------------- helpers */

async function passwordOk(request, expected) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Basic\s+([A-Za-z0-9+/=]+)$/);
  if (!m) return false;
  let given;
  try {
    const raw = atob(m[1]);
    given = new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0)));
  } catch (e) {
    return false;
  }
  const password = given.slice(given.indexOf(':') + 1);
  // Compare digests so the time taken does not depend on how much of the password matched.
  const [a, b] = await Promise.all([digest(password), digest(String(expected))]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function digest(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

function sameOrigin(request, url) {
  // Browsers set Sec-Fetch-Site themselves; pages cannot fake it.
  if (request.headers.get('Origin') === url.origin) return true;
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

function parseFiles(json) {
  try {
    const list = JSON.parse(json || '[]');
    return Array.isArray(list) ? list.filter((f) => f && typeof f.key === 'string') : [];
  } catch (e) {
    return [];
  }
}

function ukTime(utc) {
  if (!utc) return '';
  const d = new Date(String(utc).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(utc) ? '' : 'Z'));
  if (isNaN(d)) return String(utc);
  return d.toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page(status, title, body) {
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)} · Amiri enquiries</title><style>
:root{color-scheme:light dark;--bg:#f6f4ef;--fg:#1b1b1b;--card:#fff;--line:#ddd6c6;--muted:#6b665c;--gold:#b8892b}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#eee;--card:#1d1d1d;--line:#333;--muted:#a59f93;--gold:#d4a64a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header{background:#0f0f0f;color:#fff;padding:12px 16px;border-bottom:3px solid var(--gold)}header b{color:var(--gold)}
main{max-width:860px;margin:0 auto;padding:16px}a{color:var(--gold)}h2{margin:.5em 0}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}.tab{padding:6px 10px;border:1px solid var(--line);border-radius:999px;text-decoration:none;color:var(--fg);font-size:14px}
.tab.on{background:var(--gold);border-color:var(--gold);color:#111}.list{display:grid;gap:8px}
.card{display:grid;gap:2px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;text-decoration:none;color:var(--fg)}
.top{display:flex;justify-content:space-between;gap:8px;align-items:center}.muted{color:var(--muted);font-size:14px}.urg{color:#c0392b;font-weight:700}
.st{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);white-space:nowrap;font-weight:600}.st-new{background:var(--gold);color:#111;border-color:var(--gold)}
.search{display:flex;gap:6px}.search input{flex:1;min-width:0}input,select,textarea,button{font:inherit;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
button,.btn{background:var(--gold);color:#111;border-color:var(--gold);font-weight:600;cursor:pointer;text-decoration:none;display:inline-block;padding:8px 12px;border-radius:8px}
.actions{display:flex;flex-wrap:wrap;gap:8px}dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}.desc{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
.media{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}.media img{width:100%;height:140px;object-fit:cover;border-radius:8px;border:1px solid var(--line)}
.upd{display:grid;gap:10px}.upd label{display:grid;gap:4px}.ok{background:#e7f5ea;color:#1d6b33;padding:8px 12px;border-radius:8px}
@media (max-width:520px){dl{grid-template-columns:1fr}dt{margin-top:6px}}
</style></head><body><header><b>Amiri</b> enquiries</header><main>${body}</main></body></html>`;
  return new Response(html, { status, headers: { ...SECURITY, 'Content-Type': 'text/html; charset=utf-8' } });
}
