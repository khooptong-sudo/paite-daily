CREATE TABLE reviewers (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT
);
CREATE TABLE reviewer_applications (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  decided_by TEXT,
  ip_hash TEXT
);
CREATE UNIQUE INDEX reviewer_applications_pending ON reviewer_applications (lower(email)) WHERE status = 'pending';
