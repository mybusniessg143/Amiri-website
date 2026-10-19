// In-memory stand-ins for the Cloudflare bindings (D1 via node:sqlite, R2 via a Map)
// so the real request handlers can be tested end to end with Node.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

export function fakeD1(migrations = ['0001_enquiries.sql', '0002_settings.sql', '0003_contact_fields.sql']) {
  const db = new DatabaseSync(':memory:');
  for (const m of migrations) db.exec(fs.readFileSync(new URL(`../migrations/${m}`, import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => { db.prepare(sql).run(...args); return { success: true }; },
    all: async () => ({ results: db.prepare(sql).all(...args) })
  });
  return { prepare: (sql) => stmt(sql), raw: db };
}

export function fakeR2() {
  const objects = new Map();
  return {
    objects,
    put: async (key, value, opts) => { objects.set(key, { body: new Uint8Array(value), ...opts }); },
    get: async (key) => {
      const o = objects.get(key);
      return o ? { body: o.body, httpMetadata: o.httpMetadata } : null;
    },
    delete: async (keys) => { for (const k of [].concat(keys)) objects.delete(k); }
  };
}

export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
