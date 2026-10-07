-- AI Receptionist enquiries (Cloudflare D1).
-- Apply once: npx wrangler d1 execute amiri-enquiries --remote --file=migrations/0001_enquiries.sql
CREATE TABLE IF NOT EXISTS enquiries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  reference       TEXT NOT NULL UNIQUE,          -- e.g. ABS-071026-4821, shown to the customer
  created_at      TEXT NOT NULL,                 -- UTC, 'YYYY-MM-DD HH:MM:SS'
  service         TEXT NOT NULL,                 -- Electrical | Plumbing | Property Maintenance | Other
  urgency         TEXT NOT NULL,                 -- Emergency | Urgent | Planned
  postcode        TEXT NOT NULL,
  description     TEXT NOT NULL,
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,
  when_needed     TEXT NOT NULL,
  availability    TEXT,
  page            TEXT,                          -- page the chat was opened on
  files_json      TEXT NOT NULL DEFAULT '[]',    -- [{key, name, kind, size, type}] in the R2 bucket
  file_problems   TEXT,
  consent_at      TEXT NOT NULL,
  email_status    TEXT,                          -- sent | not_configured | failed: …
  whatsapp_status TEXT,
  status          TEXT NOT NULL DEFAULT 'new',   -- new | contacted | quoted | booked | closed
  ip_hash         TEXT,                          -- keyed hash, only for rate limiting
  user_agent      TEXT
);
CREATE INDEX IF NOT EXISTS enquiries_created ON enquiries (created_at);
CREATE INDEX IF NOT EXISTS enquiries_ip ON enquiries (ip_hash, created_at);
