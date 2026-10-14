-- Contributed words: glossary rows no longer need an answer or sentence, and carry a source.
CREATE TABLE glossary_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paite TEXT NOT NULL,
  english TEXT NOT NULL,
  note TEXT,
  answer_id INTEGER,
  sentence_id INTEGER,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL DEFAULT 'note'
);
INSERT INTO glossary_new (id, paite, english, note, answer_id, sentence_id, hidden, created_at)
  SELECT id, paite, english, note, answer_id, sentence_id, hidden, created_at FROM glossary;
DROP TABLE glossary;
ALTER TABLE glossary_new RENAME TO glossary;
CREATE UNIQUE INDEX glossary_unique ON glossary (lower(paite), lower(english));

CREATE TABLE word_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paite TEXT NOT NULL,
  english TEXT NOT NULL,
  note TEXT,
  phone_id TEXT NOT NULL,
  contributor_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  decided_by TEXT
);
CREATE INDEX word_submissions_by_phone_time ON word_submissions (phone_id, created_at);
CREATE INDEX word_submissions_by_status ON word_submissions (status, id);
