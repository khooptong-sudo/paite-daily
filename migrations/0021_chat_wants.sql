-- What visitors ask the chat demo for and we cannot yet answer. The most-wanted
-- lines become the next sentences put in front of contributors, so the demo feeds
-- the corpus instead of pretending to translate.
CREATE TABLE chat_wants (
  id INTEGER PRIMARY KEY,
  english TEXT NOT NULL,
  english_key TEXT NOT NULL UNIQUE,
  ask_count INTEGER NOT NULL DEFAULT 1,
  first_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX chat_wants_wanted ON chat_wants (ask_count DESC, last_at DESC);
