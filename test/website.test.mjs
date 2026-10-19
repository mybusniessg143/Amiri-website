// Tests for the website Worker (worker/index.js): routing, and the private /admin enquiry tracker.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { fakeD1, fakeR2, JPEG } from './fakes.mjs';

const BASE = 'https://amiribuildingservices.com';
const auth = (pw) => ({ Authorization: 'Basic ' + btoa('waris:' + pw) });

function setup(extra = {}) {
  const DB = fakeD1();
  const ENQUIRY_FILES = fakeR2();
  DB.raw.prepare(`INSERT INTO enquiries (reference, created_at, service, urgency, postcode, description, name, phone, when_needed,
    files_json, consent_at, email, address) VALUES (?, '2026-10-19 13:05:00', 'Plumbing', 'Urgent', 'UB7 9AA', ?, ?, '07123 456789',
    'As soon as possible', ?, '2026-10-19 13:05:00', 'sam@example.com', '1 High St')`)
    .run('ABS-191026-1111', 'Leak under <b>sink</b>', 'Sam <Test>', JSON.stringify([{ key: 'enquiries/ABS-191026-1111/photo-1.jpg', name: 'photo-1.jpg', type: 'image/jpeg', size: 20 }]));
  DB.raw.prepare(`INSERT INTO enquiries (reference, created_at, service, urgency, postcode, description, name, phone, when_needed,
    files_json, consent_at, status) VALUES ('ABS-191026-2222', '2026-10-18 09:00:00', 'Electrical', 'Planned', 'UB8 1QE', '=HYPERLINK("x")', 'Old Job', '07000 000000',
    'In the next 2 weeks', '[]', '2026-10-18 09:00:00', 'closed')`).run();
  ENQUIRY_FILES.objects.set('enquiries/ABS-191026-1111/photo-1.jpg', { body: JPEG, httpMetadata: { contentType: 'image/jpeg' } });
  ENQUIRY_FILES.objects.set('enquiries/OTHER/secret.jpg', { body: JPEG, httpMetadata: { contentType: 'image/jpeg' } });
  const assets = [];
  const env = { DB, ENQUIRY_FILES, ADMIN_PASSWORD: 'correct horse battery', ASSETS: { fetch: async (r) => { assets.push(r.url); return new Response('asset'); } }, ...extra };
  const call = (path, init = {}) => worker.fetch(new Request(BASE + path, { ...init, headers: { 'CF-Connecting-IP': '203.0.113.5', ...(init.headers || {}) } }), env);
  return { env, call, assets };
}

test('other paths go to the static site; unknown API paths are 404', async () => {
  const { call, assets } = setup();
  assert.equal(await (await call('/electrical/')).text(), 'asset');
  assert.deepEqual(assets, [BASE + '/electrical/']);
  assert.equal((await call('/api/nothing')).status, 404);
  assert.equal((await call('/api/chat')).status, 405);
});

test('the tracker is closed until a password is set, and asks for one', async () => {
  assert.equal((await setup({ ADMIN_PASSWORD: '' }).call('/admin')).status, 503);
  const { call } = setup();
  const res = await call('/admin');
  assert.equal(res.status, 401);
  assert.match(res.headers.get('WWW-Authenticate'), /^Basic/);
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.match(res.headers.get('Content-Security-Policy'), /default-src 'none'/);
  assert.equal((await call('/admin', { headers: auth('wrong') })).status, 401);
});

test('repeated wrong passwords lock the connection out', async () => {
  const { call } = setup();
  for (let i = 0; i < 10; i++) assert.equal((await call('/admin', { headers: auth('guess' + i) })).status, 401);
  assert.equal((await call('/admin', { headers: auth('correct horse battery') })).status, 429);
  // Another connection is not affected.
  assert.equal((await call('/admin', { headers: { ...auth('correct horse battery'), 'CF-Connecting-IP': '198.51.100.7' } })).status, 200);
});

test('lists open enquiries, escapes customer text, and filters by status', async () => {
  const { call } = setup();
  const html = await (await call('/admin', { headers: auth('correct horse battery') })).text();
  assert.match(html, /ABS-191026-1111/);
  assert.match(html, /Sam &lt;Test&gt;/);
  assert.doesNotMatch(html, /Sam <Test>/);
  assert.doesNotMatch(html, /ABS-191026-2222/); // closed, so not in "Open"
  const closed = await (await call('/admin?status=closed', { headers: auth('correct horse battery') })).text();
  assert.match(closed, /ABS-191026-2222/);
  const search = await (await call('/admin?status=all&q=UB8', { headers: auth('correct horse battery') })).text();
  assert.match(search, /ABS-191026-2222/);
  assert.doesNotMatch(search, /ABS-191026-1111/);
});

test('shows one enquiry with its photo, and serves only that enquiry\'s files', async () => {
  const { call } = setup();
  const h = auth('correct horse battery');
  const html = await (await call('/admin/enquiry?ref=ABS-191026-1111', { headers: h })).text();
  assert.match(html, /Leak under &lt;b&gt;sink&lt;\/b&gt;/);
  assert.match(html, /1 High St/);
  assert.match(html, /href="tel:07123456789"/);
  assert.match(html, /wa\.me\/447123456789/);
  const photo = await call('/admin/file?ref=ABS-191026-1111&k=' + encodeURIComponent('enquiries/ABS-191026-1111/photo-1.jpg'), { headers: h });
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(photo.headers.get('Content-Security-Policy'), 'sandbox');
  const other = await call('/admin/file?ref=ABS-191026-1111&k=' + encodeURIComponent('enquiries/OTHER/secret.jpg'), { headers: h });
  assert.equal(other.status, 404);
  assert.equal((await call('/admin/file?ref=ABS-191026-1111&k=enquiries/OTHER/secret.jpg')).status, 401);
});

test('status and notes are saved only from the site itself', async () => {
  const { call, env } = setup();
  const h = auth('correct horse battery');
  const body = () => new URLSearchParams({ ref: 'ABS-191026-1111', status: 'quoted', notes: 'Sent quote by WhatsApp' });
  const forged = await call('/admin/enquiry', { method: 'POST', body: body(), headers: { ...h, Origin: 'https://evil.example' } });
  assert.equal(forged.status, 403);
  const ok = await call('/admin/enquiry', { method: 'POST', body: body(), headers: { ...h, Origin: BASE } });
  assert.equal(ok.status, 303);
  assert.match(ok.headers.get('Location'), /saved=1/);
  const row = env.DB.raw.prepare("SELECT status, notes, status_updated_at FROM enquiries WHERE reference = 'ABS-191026-1111'").get();
  assert.equal(row.status, 'quoted');
  assert.equal(row.notes, 'Sent quote by WhatsApp');
  assert.ok(row.status_updated_at);
  const bad = await call('/admin/enquiry', { method: 'POST', body: new URLSearchParams({ ref: 'ABS-191026-1111', status: 'deleted' }), headers: { ...h, Origin: BASE } });
  assert.equal(bad.status, 400);
});

test('CSV export neutralises spreadsheet formulas', async () => {
  const { call } = setup();
  const res = await call('/admin/export.csv', { headers: auth('correct horse battery') });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Disposition'), /attachment; filename="amiri-enquiries-/);
  const csv = await res.text();
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.match(csv, /ABS-191026-1111/);
});
