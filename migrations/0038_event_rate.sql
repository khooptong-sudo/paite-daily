-- Per-address limit for /api/event. key: a hash of today's salt and the IP (never the IP itself), cut to 16 hex
-- characters; hour: 'YYYY-MM-DD HH' (UTC); n: events counted that hour. The nightly visitors job prunes old rows.
CREATE TABLE event_rate (
  key TEXT NOT NULL,
  hour TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (key, hour)
);
