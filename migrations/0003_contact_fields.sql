-- Optional customer email and address from the website quote form.
-- Additive only: existing rows and the older Worker code keep working.
ALTER TABLE enquiries ADD COLUMN email TEXT;
ALTER TABLE enquiries ADD COLUMN address TEXT;
