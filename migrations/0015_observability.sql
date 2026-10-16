-- Error tracking for the owner and a first-party funnel for the contributors path.
CREATE TABLE errors (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  fingerprint TEXT NOT NULL,
  route TEXT NOT NULL,
  method TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT
);
CREATE INDEX errors_by_time ON errors (at);
CREATE INDEX errors_by_fingerprint ON errors (fingerprint, at);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  vid TEXT,
  device TEXT,
  ref TEXT
);
CREATE INDEX events_by_time ON events (at);
CREATE INDEX events_by_kind_time ON events (kind, at);
