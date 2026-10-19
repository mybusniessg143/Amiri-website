// Unit tests for the enquiry back end helpers. Run: npm test (Node 18+).
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFields, validateFiles, normPostcode, normPhone, signFileUrl, verifyFileUrl, buildEmail, makeReference } from '../lib/enquiry.js';

const good = { service: 'Electrical', urgency: 'Emergency', postcode: 'ub7 7bq', description: 'Sockets tripping', name: 'Sarah Khan', phone: '07700900456', when: 'As soon as possible', availability: '', consent: 'yes', website: '' };
const getter = (o) => (k) => (k in o ? o[k] : null);

test('valid enquiry is normalised', () => {
  const r = validateFields(getter(good));
  assert.equal(r.ok, true);
  assert.equal(r.enquiry.postcode, 'UB7 7BQ');
  assert.equal(r.enquiry.phone, '07700 900456');
});

test('missing consent, bad values and honeypot are rejected', () => {
  assert.deepEqual(validateFields(getter({ ...good, consent: null })).errors, ['consent']);
  assert.deepEqual(validateFields(getter({ ...good, service: 'Gas boiler' })).errors, ['service']);
  assert.deepEqual(validateFields(getter({ ...good, website: 'http://spam' })).errors, ['spam']);
  assert.equal(normPostcode('not a postcode'), null);
  assert.equal(normPhone('12345'), null);
  assert.equal(normPhone('+44 7700 900123'), '+447700900123');
});

test('only photos and videos within limits are accepted', () => {
  const f = (name, type, size) => ({ name, type, size, arrayBuffer: async () => new ArrayBuffer(0) });
  const { accepted, problems } = validateFiles([
    f('a.jpg', 'image/jpeg', 1000), f('b.mp4', 'video/mp4', 1000), f('c.exe', 'application/x-msdownload', 1000),
    f('d.svg', 'image/svg+xml', 1000), f('e.jpg', 'image/jpeg', 50 * 1024 * 1024)
  ]);
  assert.deepEqual(accepted.map((a) => a.kind), ['photo', 'video']);
  assert.equal(problems.length, 3);
});

test('signed file links verify, and reject tampering or expiry', async () => {
  const key = 'enquiries/ABS-071026-1234/01-photo.jpg';
  const url = new URL(await signFileUrl('https://x', key, 'secret'));
  const [k, e, s] = ['k', 'e', 's'].map((n) => url.searchParams.get(n));
  assert.equal(await verifyFileUrl(k, e, s, 'secret'), true);
  assert.equal(await verifyFileUrl(k, e, s + 'x', 'secret'), false);
  assert.equal(await verifyFileUrl('enquiries/ABS-071026-1234/../other', e, s, 'secret'), false);
  assert.equal(await verifyFileUrl(k, e, s, 'secret', Date.now() + 31 * 86400e3), false);
});

test('email summary has every field and escapes HTML', () => {
  const e = { ...validateFields(getter({ ...good, description: '<script>x</script> sparks' })).enquiry, reference: makeReference(), createdAt: new Date().toISOString() };
  const { subject, html, text } = buildEmail(e, [{ name: '01-a.jpg', kind: 'photo', size: 2048, url: 'https://x/f' }]);
  assert.match(subject, /^EMERGENCY: Electrical – Sarah Khan, UB7 7BQ \(ABS-\d{6}-\d{4}\)$/);
  for (const v of ['Sarah Khan', '07700 900456', 'UB7 7BQ', 'Electrical', 'EMERGENCY', 'As soon as possible', '1 photo']) assert.ok(text.includes(v), v);
  assert.ok(!html.includes('<script>'));
});
