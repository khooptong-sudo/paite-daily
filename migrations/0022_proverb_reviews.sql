-- Sayings move onto the same rails the sentence lane already uses, so a
-- reviewer there recognises this immediately.
--
-- proverb_votes was my first attempt: a plain counter. It is replaced by
-- proverb_reviews, which records what the sentence lane's `reviews` records,
-- including final_paite. That column is what makes "correct it" possible while
-- keeping the contributor's original text intact.
DROP TABLE IF EXISTS proverb_votes;

-- answers gains also_correct, the status a variant keeps, matching `answers`.
CREATE TABLE proverb_answers_new (
  id INTEGER PRIMARY KEY,
  proverb_id INTEGER NOT NULL REFERENCES proverbs (id),
  paite TEXT NOT NULL,
  explainer TEXT,
  explainer_en TEXT,
  phone_id TEXT NOT NULL,
  contributor_name TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'also_correct', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO proverb_answers_new (id, proverb_id, paite, explainer, explainer_en, phone_id, contributor_name, status, created_at)
SELECT id, proverb_id, paite, explainer, explainer_en, phone_id, contributor_name, status, created_at FROM proverb_answers;

DROP TABLE proverb_answers;
ALTER TABLE proverb_answers_new RENAME TO proverb_answers;

CREATE INDEX proverb_answers_by_proverb ON proverb_answers (proverb_id, status);

-- One row per reviewer per saying, with the decision, the text they settled on,
-- and their note. Two distinct accepts are needed before a saying publishes.
CREATE TABLE proverb_reviews (
  id INTEGER PRIMARY KEY,
  proverb_id INTEGER NOT NULL REFERENCES proverbs (id),
  answer_id INTEGER REFERENCES proverb_answers (id),
  reviewer_email TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accept', 'reject', 'variant')),
  final_paite TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  undone_at TEXT
);

-- answer_id is NULL for a whole submitted saying, and NULLs compare as distinct,
-- so the coalesce is what makes one review per reviewer actually hold.
CREATE UNIQUE INDEX proverb_reviews_once ON proverb_reviews (proverb_id, COALESCE(answer_id, 0), lower(reviewer_email), decision);
CREATE INDEX proverb_reviews_by_answer ON proverb_reviews (answer_id, decision);

-- A live saying can keep collecting renderings. The public page reads this to
-- put the English line back in the pool without ever showing the Paite one.
ALTER TABLE proverbs ADD COLUMN accepting_more INTEGER NOT NULL DEFAULT 0;
