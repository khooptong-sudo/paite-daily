-- Wiki articles. Status: draft (being written), pending (waiting for another reviewer), published, withdrawn.
CREATE TABLE kb_articles (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'published', 'withdrawn')),
  rev_id INTEGER,                       -- current revision
  created_by TEXT NOT NULL,
  published_by TEXT,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Every saved version. body is JSON blocks; cited is JSON [[chunk_id, sha256], ...] of the passages it quotes or cites.
CREATE TABLE kb_article_revs (
  id INTEGER PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES kb_articles (id),
  body TEXT NOT NULL,
  cited TEXT NOT NULL,
  author TEXT NOT NULL,                 -- reviewer email, or 'ai:<model>' for a draft
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX kb_article_revs_article ON kb_article_revs (article_id, id);
