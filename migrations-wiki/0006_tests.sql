-- Questions used to measure the ask engine before and after launch.
-- kind: owner (written by the owner or reviewers), auto (made from the site's own data), attack (tries to break the rules).
-- expect: the source the answer should cite, as a site_key (proverb:12, glossary:40) or 'source:<id>'; null for attacks.
CREATE TABLE kb_tests (
  id INTEGER PRIMARY KEY,
  q TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('owner', 'auto', 'attack')),
  expect TEXT,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  added_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (q)
);
CREATE TABLE kb_test_runs (id INTEGER PRIMARY KEY, started_by TEXT NOT NULL, started_at INTEGER NOT NULL, total INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0);
-- One row per question per run. hit: the answer cited the expected source (null when there is no expectation).
CREATE TABLE kb_test_results (run_id INTEGER NOT NULL REFERENCES kb_test_runs (id), test_id INTEGER NOT NULL REFERENCES kb_tests (id), ask_id INTEGER, status TEXT NOT NULL, hit INTEGER, PRIMARY KEY (run_id, test_id));
