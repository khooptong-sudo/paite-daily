-- The Paite Wiki's sources. Nothing is searchable until approved. rights decides what may be
-- shown and exported: only 'open' and 'permission' sources may ever leave for the dataset.
CREATE TABLE kb_sources (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('site', 'book', 'article', 'web', 'other')),
  site_key TEXT UNIQUE,
  title TEXT NOT NULL,
  author TEXT,
  publisher TEXT,
  year TEXT,
  url TEXT,
  language TEXT NOT NULL DEFAULT 'mixed' CHECK (language IN ('pck', 'en', 'mixed')),
  rights TEXT NOT NULL CHECK (rights IN ('open', 'permission', 'quote-only', 'index-only')),
  rights_note TEXT,
  exportable INTEGER NOT NULL DEFAULT 0 CHECK (exportable IN (0, 1)),
  trust INTEGER NOT NULL CHECK (trust IN (1, 2, 3)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  r2_key TEXT,
  sha256 TEXT,
  added_by TEXT NOT NULL,
  decided_by TEXT,
  decided_at INTEGER,
  withdrawn_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX kb_sources_status ON kb_sources (status, kind);
-- A source's text, cut into passages. locator says where in the source ("p. 12", a heading).
CREATE TABLE kb_chunks (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES kb_sources (id),
  ordinal INTEGER NOT NULL,
  locator TEXT,
  text TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  UNIQUE (source_id, ordinal)
);
-- Full-text index over the passages, kept in step by the triggers below.
-- unicode61 with remove_diacritics 2 matches Paite typed with or without marks.
CREATE VIRTUAL TABLE kb_chunks_fts USING fts5(text, content = 'kb_chunks', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2');
CREATE TRIGGER kb_chunks_ai AFTER INSERT ON kb_chunks BEGIN
  INSERT INTO kb_chunks_fts (rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER kb_chunks_ad AFTER DELETE ON kb_chunks BEGIN
  INSERT INTO kb_chunks_fts (kb_chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER kb_chunks_au AFTER UPDATE ON kb_chunks BEGIN
  INSERT INTO kb_chunks_fts (kb_chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO kb_chunks_fts (rowid, text) VALUES (new.id, new.text);
END;
