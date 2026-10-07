-- Small key/value store for settings the back end creates itself
-- (FILE_LINK_SECRET is generated here on first use if it isn't set as a Worker secret).
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
