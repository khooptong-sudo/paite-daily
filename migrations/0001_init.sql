CREATE TABLE sentences (
  id INTEGER PRIMARY KEY,
  english TEXT NOT NULL,
  english_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'full', 'verified', 'retired')),
  answer_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX sentences_pool ON sentences (status, answer_count);

CREATE TABLE answers (
  id INTEGER PRIMARY KEY,
  sentence_id INTEGER NOT NULL REFERENCES sentences (id),
  paite TEXT NOT NULL,
  register TEXT NOT NULL CHECK (register IN ('spoken', 'written', 'both')),
  phone_id TEXT NOT NULL,
  contributor_name TEXT,
  ai_note TEXT,
  ai_flag TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'also_correct', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX answers_by_phone_time ON answers (phone_id, created_at);
CREATE INDEX answers_by_sentence ON answers (sentence_id, status);

CREATE TABLE seen (
  phone_id TEXT NOT NULL,
  sentence_id INTEGER NOT NULL REFERENCES sentences (id),
  action TEXT NOT NULL CHECK (action IN ('answered', 'skipped')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (phone_id, sentence_id)
);

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY,
  sentence_id INTEGER NOT NULL REFERENCES sentences (id),
  reviewer_email TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accept', 'reject', 'retire')),
  accepted_answer_id INTEGER REFERENCES answers (id),
  final_paite TEXT,
  register TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  undone_at TEXT
);

CREATE TABLE locks (
  sentence_id INTEGER PRIMARY KEY REFERENCES sentences (id),
  reviewer_email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE exports (
  id INTEGER PRIMARY KEY,
  first_review_id INTEGER NOT NULL,
  last_review_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE job_runs (
  id INTEGER PRIMARY KEY,
  job TEXT NOT NULL,
  ok INTEGER NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
