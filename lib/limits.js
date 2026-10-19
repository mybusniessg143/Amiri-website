/*
 * Small usage counters kept in D1 (table "counters", migrations/0004), used to keep
 * the AI answers inside Workers AI's free daily allowance and to slow down
 * password guessing on the /admin page. Old rows are cleared after a week.
 */

/** Adds one to a counter and returns the new total. */
export async function bump(db, bucket, day) {
  const row = await db.prepare(
    'INSERT INTO counters (bucket, day, count) VALUES (?1, ?2, 1) ON CONFLICT(bucket) DO UPDATE SET count = count + 1 RETURNING count'
  ).bind(bucket, day).first();
  return row ? Number(row.count) : 1;
}

export async function peek(db, bucket) {
  const row = await db.prepare('SELECT count FROM counters WHERE bucket = ?1').bind(bucket).first();
  return row ? Number(row.count) : 0;
}

/** Occasionally removes counters older than a week (about 1 call in 50). */
export async function tidy(db, now = new Date()) {
  if (Math.random() > 0.02) return;
  const cutoff = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  await db.prepare('DELETE FROM counters WHERE day < ?1').bind(cutoff).run();
}

/**
 * FILE_LINK_SECRET signs photo links and keys the IP hashes. A Worker secret wins;
 * otherwise one random value is generated once and kept in D1 (table "settings"),
 * shared by the website Worker and the receptionist API Worker.
 */
let cached;
export async function linkSecret(env) {
  if (env.FILE_LINK_SECRET) return env.FILE_LINK_SECRET;
  if (cached || !env.DB) return cached;
  const fresh = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('FILE_LINK_SECRET', ?1)").bind(fresh).run();
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'FILE_LINK_SECRET'").first();
  cached = row && row.value;
  return cached;
}
