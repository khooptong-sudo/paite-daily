-- Hear it: a contributor with a verified sentence records a verified Paite line.
-- The clip lives in R2 under r2_key; this row holds what was shown, who spoke,
-- the consent they gave, and the single review that publishes or rejects it.
CREATE TABLE recordings (
  id INTEGER PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES reviews (id),
  sentence_id INTEGER NOT NULL REFERENCES sentences (id),
  paite TEXT NOT NULL,
  phone_id TEXT NOT NULL,
  contributor_name TEXT,
  r2_key TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  consent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX recordings_queue ON recordings (status, id);
CREATE INDEX recordings_by_phone_time ON recordings (phone_id, created_at);
CREATE INDEX recordings_by_review ON recordings (review_id, status);
