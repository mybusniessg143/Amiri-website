-- Enquiry tracking (website /admin page) and usage counters (AI answer limits, sign-in lockout).
-- Additive only: existing rows and the older Worker code keep working.
ALTER TABLE enquiries ADD COLUMN notes TEXT;
ALTER TABLE enquiries ADD COLUMN status_updated_at TEXT;
CREATE INDEX IF NOT EXISTS enquiries_status ON enquiries (status, created_at);
CREATE TABLE IF NOT EXISTS counters (
  bucket TEXT PRIMARY KEY,          -- e.g. ai:2026-10-19:all, ai:2026-10-19:<ip hash>, login:2026-10-19T14:<ip hash>
  day    TEXT NOT NULL,             -- YYYY-MM-DD, for clearing old rows
  count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS counters_day ON counters (day);
