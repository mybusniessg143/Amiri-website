#!/usr/bin/env node
/*
 * Live checks for amiribuildingservices.com (run by .github/workflows/live-check.yml,
 * or locally: node scripts/live-check.mjs). Read-only unless SEND_TEST_ENQUIRIES=1.
 *
 *  - DNS: Google Workspace mail (MX, SPF, DKIM, DMARC), Resend records, root and www
 *  - HTTPS: both domains, http -> https redirect, security headers, robots.txt, sitemap
 *  - Every page in the sitemap answers 200 and has a title, description and canonical
 *  - Receptionist API: CORS for the live site, other sites refused
 *  - SEND_TEST_ENQUIRIES=1: real test enquiries through the API (stored in D1, photos in R2,
 *    emailed to the business), each clearly labelled as a test.
 */
import { execFileSync } from 'node:child_process';

const SITE = 'https://amiribuildingservices.com';
const WWW = 'https://www.amiribuildingservices.com';
const API = process.env.ENQUIRY_API || 'https://amiri-receptionist-api.waris-ac2.workers.dev/api/enquiry';
let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` – ${detail}` : ''}`);
};
const info = (label, detail) => console.log(`INFO  ${label}: ${detail}`);

function dig(name, type) {
  try {
    return execFileSync('dig', ['+short', type, name], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  } catch (e) {
    return [];
  }
}

console.log('\n== DNS');
const mx = dig('amiribuildingservices.com', 'MX');
info('MX', mx.join(' | ') || 'none');
ok(mx.some((r) => /google\.com\.?$/i.test(r)), 'MX points to Google Workspace');
const txt = dig('amiribuildingservices.com', 'TXT');
const spf = txt.filter((t) => /v=spf1/i.test(t));
info('SPF', spf.join(' | ') || 'none');
ok(spf.length === 1 && /include:_spf\.google\.com/.test(spf[0]), 'exactly one SPF record, includes Google');
const dmarc = dig('_dmarc.amiribuildingservices.com', 'TXT');
info('DMARC', dmarc.join(' | ') || 'none');
ok(dmarc.some((t) => /v=DMARC1/i.test(t)), 'DMARC record present');
const gdkim = dig('google._domainkey.amiribuildingservices.com', 'TXT');
ok(gdkim.some((t) => /v=DKIM1|p=/i.test(t)), 'Google DKIM (google._domainkey) present');
const rdkim = dig('resend._domainkey.amiribuildingservices.com', 'TXT');
info('Resend DKIM (resend._domainkey)', rdkim.length ? 'present' : 'not set (domain not verified in Resend yet)');
info('Resend return path (send.)', [...dig('send.amiribuildingservices.com', 'MX'), ...dig('send.amiribuildingservices.com', 'TXT')].join(' | ') || 'not set');
info('root A/AAAA', [...dig('amiribuildingservices.com', 'A'), ...dig('amiribuildingservices.com', 'AAAA')].join(' '));
info('www', [...dig('www.amiribuildingservices.com', 'CNAME'), ...dig('www.amiribuildingservices.com', 'A')].join(' '));

console.log('\n== HTTPS and headers');
const get = (url, opts = {}) => fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'AmiriLiveCheck/1.0' }, ...opts });
const home = await get(SITE + '/');
ok(home.status === 200, 'https://amiribuildingservices.com/ answers 200', String(home.status));
const html = await home.text();
const www = await get(WWW + '/');
ok(www.status === 200 || (www.status >= 301 && www.status <= 308 && (www.headers.get('location') || '').startsWith(SITE)), 'www answers (200 or redirect to root)', `${www.status} ${www.headers.get('location') || ''}`);
const http = await get('http://amiribuildingservices.com/');
ok(http.status >= 301 && http.status <= 308 && /^https:/.test(http.headers.get('location') || ''), 'http redirects to https', `${http.status} ${http.headers.get('location') || ''}`);
const h = home.headers;
ok(/max-age=\d+/.test(h.get('strict-transport-security') || ''), 'HSTS header');
const csp = h.get('content-security-policy') || '';
ok(csp.includes('frame-ancestors'), 'Content-Security-Policy header');
info('CSP allows the enquiry API', String(csp.includes(new URL(API).host)));
ok(h.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options');
info('live form posts to API', String(/data-api="1"/.test(html)));
info('live build', (html.match(/assets\/js\/main\.js\?v=([\w]+)/) || [])[1] || '?');

const robots = await (await get(SITE + '/robots.txt')).text();
ok(/Sitemap: https:\/\/amiribuildingservices\.com\/sitemap\.xml/.test(robots), 'robots.txt lists the sitemap');
const sm = await get(SITE + '/sitemap.xml');
const locs = [...(await sm.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
ok(sm.status === 200 && locs.length >= 15, 'sitemap.xml', `${locs.length} pages`);

console.log('\n== Pages');
for (const loc of locs) {
  const r = await get(loc);
  const page = await r.text();
  const title = (page.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  const good = r.status === 200 && title && /<meta name="description"/.test(page) && page.includes(`<link rel="canonical" href="${loc}"`);
  ok(good, new URL(loc).pathname, `${r.status} "${title}"`);
}
const nf = await get(SITE + '/this-page-does-not-exist/');
ok(nf.status === 404, 'unknown address gives 404', String(nf.status));

console.log('\n== Receptionist API');
const pre = await fetch(API, { method: 'OPTIONS', headers: { Origin: SITE, 'Access-Control-Request-Method': 'POST' } });
ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === SITE, 'CORS allows amiribuildingservices.com', String(pre.status));
const preW = await fetch(API, { method: 'OPTIONS', headers: { Origin: WWW, 'Access-Control-Request-Method': 'POST' } });
ok(preW.status === 204, 'CORS allows www', String(preW.status));
const evil = await fetch(API, { method: 'POST', headers: { Origin: 'https://evil.example' }, body: new FormData() });
ok(evil.status === 403, 'other websites are refused', String(evil.status));
const getApi = await fetch(API);
ok(getApi.status === 405, 'GET is refused', String(getApi.status));

if (process.env.SEND_TEST_ENQUIRIES === '1') {
  console.log('\n== Test enquiries (real, labelled TEST)');
  // 1x1 JPEG
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const base = (over) => {
    const f = {
      service: 'Electrical', urgency: 'Planned', when: "I'm flexible", postcode: 'UB7 9FX', name: 'TEST Claude check',
      phone: '07700 900001', email: 'waris@amiribuildingservices.com', address: 'TEST – no visit needed', availability: '',
      consent: 'yes', page: '/ (automated live check)', website: '', elapsed: '30000', ...over
    };
    f.description = `Service: Tripping circuit\nEmail: ${f.email}\nAddress: ${f.address}\n\n${f.description}`;
    const fd = new FormData();
    for (const [k, v] of Object.entries(f)) fd.append(k, v);
    return fd;
  };
  const send = async (label, fd, expect) => {
    const r = await fetch(API, { method: 'POST', headers: { Origin: SITE }, body: fd });
    const body = await r.json().catch(() => ({}));
    ok(expect(r, body), label, `${r.status} ${JSON.stringify(body)}`);
    return body;
  };
  const one = base({ description: `TEST ${stamp} – automated check with a photo, please ignore.` });
  one.append('files', new Blob([jpeg], { type: 'image/jpeg' }), 'test-photo.jpg');
  await send('enquiry with photo is accepted and stored', one, (r, b) => r.status === 200 && b.ok && b.filesReceived === 1);
  await send('enquiry from the chat (urgent plumbing, no photo)', base({ service: 'Plumbing', urgency: 'Urgent', when: 'In the next few days', phone: '07700 900002', page: '/plumbing/ (automated live check)', description: `TEST ${stamp} – automated chat-style check, please ignore.` }), (r, b) => r.status === 200 && b.ok);
  const bad = base({ phone: '07700 900003', description: `TEST ${stamp} – automated check, a fake photo must be refused.` });
  bad.append('files', new Blob(['<?php echo 1; ?>'], { type: 'image/jpeg' }), 'fake.jpg');
  const fake = await fetch(API, { method: 'POST', headers: { Origin: SITE }, body: bad }).then((r) => r.json()).catch(() => ({}));
  // File-content checking arrived with the October 2026 back-end update; older deployments store the file.
  info('fake photo refused (needs the updated API deployed)', `${fake.filesRejected === 1 && fake.filesReceived === 0 ? 'yes' : 'NO'} ${JSON.stringify(fake)}`);
  await send('honeypot (bot) gets a normal reply', base({ website: 'http://spam.example', description: 'TEST honeypot, must not be stored' }), (r, b) => r.status === 200);
  await send('missing details are refused', base({ postcode: 'nowhere', consent: 'no', description: 'TEST invalid' }), (r) => r.status === 400);
}

console.log(`\n${failures ? `${failures} check(s) FAILED` : 'All checks passed'}`);
process.exit(failures ? 1 : 0);
