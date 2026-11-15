-- Visitors dashboard on /admin. Still no cookie and no IP address stored.
-- visitor: SHA-256 of a salt that changes every day (IST), the IP and the browser, cut to 16 hex
--   characters. The salt is deleted after two days, so the same person cannot be linked across days.
-- via: a tag from a shared link (?via=wa), so WhatsApp, which sends no referrer, is visible.
-- country, region, city: Cloudflare's location for the request. Cities are shown only when two or
--   more visitors came from one.
-- revisit: 1 when this browser had visited before (a yes/no in localStorage, never an id).
-- ms: engaged time on a page, on 'leave' events only.
ALTER TABLE events ADD COLUMN visitor TEXT;
ALTER TABLE events ADD COLUMN via TEXT;
ALTER TABLE events ADD COLUMN country TEXT;
ALTER TABLE events ADD COLUMN region TEXT;
ALTER TABLE events ADD COLUMN city TEXT;
ALTER TABLE events ADD COLUMN browser TEXT;
ALTER TABLE events ADD COLUMN os TEXT;
ALTER TABLE events ADD COLUMN revisit INTEGER;
ALTER TABLE events ADD COLUMN ms INTEGER;
CREATE INDEX events_by_vid ON events (vid, id);

CREATE TABLE visit_salts (
  day TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);

-- Daily totals, kept after the raw events are gone (30 days). One row per IST day, dimension and key;
-- the ('all', '') row exists for every rolled day, even an empty one, so a rolled day is never re-rolled.
-- Visitors add up across days because the visitor code changes every day.
CREATE TABLE visit_stats (
  day TEXT NOT NULL,
  dim TEXT NOT NULL,
  key TEXT NOT NULL,
  visitors INTEGER NOT NULL,
  visits INTEGER NOT NULL,
  hits INTEGER NOT NULL,
  bounces INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  PRIMARY KEY (day, dim, key)
);
