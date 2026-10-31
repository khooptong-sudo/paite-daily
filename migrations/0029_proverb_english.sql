-- A saying has two sides. A contributor fills whichever one is missing: the Paite
-- for an English idiom (as before), or the English for a Paite proverb. The answer
-- table held only `paite`, so it is rebuilt to hold either side, and a reviewer's
-- settled English is kept beside their settled Paite.
--
-- proverb_answers is referenced by proverb_reviews, so a plain DROP fails under
-- foreign keys. The reviews are parked and recreated around the rebuild instead.
CREATE TABLE proverb_reviews_parked AS SELECT * FROM proverb_reviews;
DROP TABLE proverb_reviews;

CREATE TABLE proverb_answers_new (
  id INTEGER PRIMARY KEY,
  proverb_id INTEGER NOT NULL REFERENCES proverbs (id),
  paite TEXT,
  english TEXT,
  explainer TEXT,
  explainer_en TEXT,
  phone_id TEXT NOT NULL,
  contributor_name TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'also_correct', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (paite IS NOT NULL OR english IS NOT NULL)
);

INSERT INTO proverb_answers_new (id, proverb_id, paite, english, explainer, explainer_en, phone_id, contributor_name, status, created_at)
SELECT id, proverb_id, paite, NULL, explainer, explainer_en, phone_id, contributor_name, status, created_at FROM proverb_answers;

DROP TABLE proverb_answers;
ALTER TABLE proverb_answers_new RENAME TO proverb_answers;

CREATE INDEX proverb_answers_by_proverb ON proverb_answers (proverb_id, status);

CREATE TABLE proverb_reviews (
  id INTEGER PRIMARY KEY,
  proverb_id INTEGER NOT NULL REFERENCES proverbs (id),
  answer_id INTEGER REFERENCES proverb_answers (id),
  reviewer_email TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accept', 'reject', 'variant')),
  final_paite TEXT,
  final_english TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  undone_at TEXT,
  answer_ids TEXT,
  published INTEGER NOT NULL DEFAULT 0
);

INSERT INTO proverb_reviews (id, proverb_id, answer_id, reviewer_email, decision, final_paite, note, created_at, undone_at, answer_ids, published)
SELECT id, proverb_id, answer_id, reviewer_email, decision, final_paite, note, created_at, undone_at, answer_ids, published FROM proverb_reviews_parked;

DROP TABLE proverb_reviews_parked;

CREATE UNIQUE INDEX proverb_reviews_once
  ON proverb_reviews (proverb_id, COALESCE(answer_id, 0), lower(reviewer_email), decision)
  WHERE undone_at IS NULL;
CREATE INDEX proverb_reviews_by_answer ON proverb_reviews (answer_id, decision);
