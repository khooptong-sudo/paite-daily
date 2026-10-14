CREATE TABLE glossary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paite TEXT NOT NULL,
  english TEXT NOT NULL,
  note TEXT,
  answer_id INTEGER NOT NULL,
  sentence_id INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX glossary_unique ON glossary (lower(paite), lower(english));
ALTER TABLE answers ADD COLUMN gloss_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE answers ADD COLUMN gloss_attempts INTEGER NOT NULL DEFAULT 0;
