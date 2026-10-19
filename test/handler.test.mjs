// End-to-end tests of POST /api/enquiry with in-memory D1/R2 and a stubbed Resend API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/enquiry.js';
import { onRequestGet } from '../functions/api/enquiry-file.js';
import { fakeD1, fakeR2, JPEG } from './fakes.mjs';

const ORIGIN = 'https://amiribuildingservices.com';
const API = 'https://amiri-receptionist-api.example.workers.dev/api/enquiry';

function setup(opts = {}) {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return opts.resendFails ? new Response('{"message":"API key is invalid"}', { status: 401 }) : new Response('{"id":"x"}', { status: 200 });
  };
  const env = {
    ENQUIRY_API_ENABLED: 'true', ALLOWED_ORIGINS: ORIGIN, DB: fakeD1(opts.migrations), ENQUIRY_FILES: fakeR2(),
    FILE_LINK_SECRET: 'test-secret', RESEND_API_KEY: 're_test', EMAIL_TO: 'waris@amiribuildingservices.com',
    EMAIL_FROM: 'Amiri Website <onboarding@resend.dev>'
  };
  return { env, sent };
}

// Same fields, in the same way, as the website quote form (assets/js/main.js).
function formData(over = {}, files = []) {
  const f = {
    service: 'Electrical', urgency: 'Emergency', when: 'As soon as possible', postcode: 'ub8 1qe',
    description: 'Service: Tripping circuit\nEmail: sam@example.com\nAddress: 1 Test Road\n\nKitchen sockets keep tripping.',
    name: 'Sam Test', phone: '07700 900456', email: 'sam@example.com', address: '1 Test Road', availability: '',
    consent: 'yes', page: '/ (quote form)', website: '', elapsed: '20000', ...over
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(f)) if (v != null) fd.append(k, v);
  for (const file of files) fd.append('files', file, file.name);
  return fd;
}
const post = (env, fd, ip = '203.0.113.7') =>
  onRequestPost({ request: new Request(API, { method: 'POST', body: fd, headers: { Origin: ORIGIN, 'CF-Connecting-IP': ip } }), env, waitUntil: (p) => p });

test('quote form enquiry is saved, photo stored, email sent with every detail', async () => {
  const { env, sent } = setup();
  const photo = new File([JPEG], 'socket.jpg', { type: 'image/jpeg' });
  const res = await post(env, formData({}, [photo]));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.match(body.reference, /^ABS-\d{6}-\d{4}$/);
  assert.equal(body.filesReceived, 1);
  const row = env.DB.raw.prepare('SELECT * FROM enquiries').get();
  assert.equal(row.email, 'sam@example.com');
  assert.equal(row.address, '1 Test Road');
  assert.equal(row.postcode, 'UB8 1QE');
  assert.equal(row.description, 'Service: Tripping circuit\n\nKitchen sockets keep tripping.');
  assert.equal(row.email_status, 'sent');
  assert.equal(env.ENQUIRY_FILES.objects.size, 1);
  const mail = sent[0].body;
  assert.deepEqual(mail.to, ['waris@amiribuildingservices.com']);
  assert.equal(mail.reply_to, 'sam@example.com');
  assert.equal(mail.attachments.length, 1);
  for (const v of ['Sam Test', '07700 900456', 'sam@example.com', '1 Test Road', 'UB8 1QE', 'Tripping circuit', 'Kitchen sockets keep tripping', 'EMERGENCY']) {
    assert.ok(mail.text.includes(v), v);
  }

  // The signed photo link in the email opens the stored photo.
  const link = mail.text.match(/https:\/\/\S+\/api\/enquiry-file\S+/)[0];
  const file = await onRequestGet({ request: new Request(link), env });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('Content-Type'), 'image/jpeg');
});

test('double submission returns the first reference and sends one email', async () => {
  const { env, sent } = setup();
  const a = await (await post(env, formData())).json();
  const b = await (await post(env, formData())).json();
  assert.equal(b.reference, a.reference);
  assert.equal(b.duplicate, true);
  assert.equal(sent.length, 1);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM enquiries').get().n, 1);
});

test('renamed or oversized files are refused and never stored', async () => {
  const { env } = setup();
  const fake = new File([new TextEncoder().encode('<?php echo 1; ?>xxxxxxxx')], 'photo.jpg', { type: 'image/jpeg' });
  const svg = new File(['<svg onload=alert(1)>'], 'x.svg', { type: 'image/svg+xml' });
  const big = new File([new Uint8Array(16 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
  const res = await (await post(env, formData({}, [fake, svg, big]))).json();
  assert.equal(res.filesReceived, 0);
  assert.equal(res.filesRejected, 3);
  assert.equal(env.ENQUIRY_FILES.objects.size, 0);
});

test('spam: honeypot and instant posts get a normal reply but nothing is stored or sent', async () => {
  const { env, sent } = setup();
  assert.equal((await post(env, formData({ website: 'http://spam' }))).status, 200);
  assert.equal((await post(env, formData({ elapsed: '400' }))).status, 200);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM enquiries').get().n, 0);
  assert.equal(sent.length, 0);
});

test('invalid details are rejected with the field names', async () => {
  const { env } = setup();
  const res = await post(env, formData({ email: 'not-an-email', postcode: 'nowhere', consent: null }));
  assert.equal(res.status, 400);
  assert.deepEqual((await res.json()).fields.sort(), ['consent', 'email', 'postcode']);
});

test('other websites cannot submit', async () => {
  const { env } = setup();
  const res = await onRequestPost({ request: new Request(API, { method: 'POST', body: formData(), headers: { Origin: 'https://evil.example' } }), env });
  assert.equal(res.status, 403);
});

test('rate limit: a sixth enquiry from one connection within an hour is refused', async () => {
  const { env } = setup();
  for (let i = 0; i < 5; i++) assert.equal((await post(env, formData({ description: `Problem number ${i} here` }))).status, 200);
  assert.equal((await post(env, formData({ description: 'Problem number 6 here' }))).status, 429);
});

test('email failure: enquiry is still saved and the failure recorded', async () => {
  const { env } = setup({ resendFails: true });
  const res = await post(env, formData());
  assert.equal(res.status, 200);
  assert.match(env.DB.raw.prepare('SELECT email_status FROM enquiries').get().email_status, /^failed: Resend 401/);
});

test('database without migration 0003 still saves the enquiry', async () => {
  const { env } = setup({ migrations: ['0001_enquiries.sql', '0002_settings.sql'] });
  const res = await post(env, formData());
  assert.equal(res.status, 200);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM enquiries').get().n, 1);
});

test('enquiries older than 12 months are deleted with their files', async () => {
  const { env } = setup();
  env.DB.raw.exec(`INSERT INTO enquiries (reference, created_at, service, urgency, postcode, description, name, phone, when_needed, files_json, consent_at)
    VALUES ('ABS-010125-1111', datetime('now','-400 days'), 'Electrical', 'Planned', 'UB7 9AA', 'old', 'Old', '07700900000', 'I''m flexible', '[{"key":"enquiries/ABS-010125-1111/01-a.jpg"}]', datetime('now','-400 days'))`);
  await env.ENQUIRY_FILES.put('enquiries/ABS-010125-1111/01-a.jpg', JPEG, {});
  const pending = [];
  await onRequestPost({ request: new Request(API, { method: 'POST', body: formData(), headers: { Origin: ORIGIN } }), env, waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM enquiries WHERE reference = 'ABS-010125-1111'").get().n, 0);
  assert.equal(env.ENQUIRY_FILES.objects.has('enquiries/ABS-010125-1111/01-a.jpg'), false);
});
