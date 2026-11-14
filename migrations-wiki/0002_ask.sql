-- Every question asked, for review and for finding gaps. No IP address is stored.
CREATE TABLE kb_asks (
  id INTEGER PRIMARY KEY,
  q TEXT NOT NULL,
  q_key TEXT NOT NULL,
  via TEXT NOT NULL CHECK (via IN ('review', 'public')),
  retrieved TEXT NOT NULL DEFAULT '[]',          -- JSON array of chunk ids sent to the model
  status TEXT NOT NULL CHECK (status IN ('answer', 'none', 'failed', 'cached', 'limited', 'error')),
  reason TEXT,                                    -- why failed / error / limited, null otherwise
  model TEXT,
  ms INTEGER,
  at INTEGER NOT NULL
);
CREATE INDEX kb_asks_status ON kb_asks (status, at);
-- Checked answers, reused for 7 days ('none' for 1 day) while every cited passage is unchanged and approved.
CREATE TABLE kb_ask_cache (
  q_key TEXT PRIMARY KEY,
  answer TEXT NOT NULL,                           -- JSON of the Answer returned to the caller
  cited TEXT NOT NULL,                            -- JSON array of [chunk_id, sha256] pairs
  at INTEGER NOT NULL
);
-- "Was this right?" from the answer card (plan 004). by_key is the reviewer email or the hashed IP, so one vote per person per answer.
CREATE TABLE kb_flags (
  id INTEGER PRIMARY KEY,
  ask_id INTEGER NOT NULL REFERENCES kb_asks (id),
  right INTEGER NOT NULL CHECK (right IN (0, 1)),
  note TEXT,
  by_key TEXT NOT NULL,
  at INTEGER NOT NULL,
  UNIQUE (ask_id, by_key)
);
-- Counters: per-hour question limits and the daily model-call cap. n counts up; old rows are harmless and tiny.
CREATE TABLE kb_counters (name TEXT PRIMARY KEY, n INTEGER NOT NULL);
