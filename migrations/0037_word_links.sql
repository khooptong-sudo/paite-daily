-- A contributor says two Paite words mean the same, or the opposite. Shown only once a reviewer approves.
-- `paite` is the headword shown to the contributor (from the list); `other` is the word they gave, which may
-- not be in the list yet. Links read both ways: a link from A to B also shows on B.
CREATE TABLE word_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paite TEXT NOT NULL,
  other TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('same', 'opposite')),
  phone_id TEXT NOT NULL,
  contributor_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  decided_by TEXT,
  reviewed_by TEXT
);
CREATE INDEX word_links_by_status ON word_links (status, id);
CREATE INDEX word_links_by_phone ON word_links (phone_id, created_at);
-- Every read of a verified sentence's final Paite looks up its accepting review (src/final.ts).
-- Without this index each lookup scans the whole reviews table.
CREATE INDEX IF NOT EXISTS reviews_by_accepted_answer ON reviews (accepted_answer_id, decision);
