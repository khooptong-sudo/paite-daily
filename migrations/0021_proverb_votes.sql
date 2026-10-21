-- Sayings need two reviewers before they go live, the same as sentence answers
-- need a reviewer who is not the person who wrote them. Votes are kept so the
-- count is auditable and the same reviewer cannot count twice.
--
-- The CHECK constraints on proverb_answers and proverbs are left alone on
-- purpose. A candidate stays 'new' until two reviewers accept it, and only then
-- does it become 'accepted'.
CREATE TABLE proverb_votes (
  id INTEGER PRIMARY KEY,
  proverb_id INTEGER NOT NULL REFERENCES proverbs (id),
  answer_id INTEGER REFERENCES proverb_answers (id),
  reviewer_email TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accept', 'reject')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One vote per reviewer per candidate. answer_id is NULL for a whole submitted
-- saying, and NULLs compare as distinct, so the coalesce is what makes the
-- index actually hold.
CREATE UNIQUE INDEX proverb_votes_once ON proverb_votes (proverb_id, COALESCE(answer_id, 0), lower(reviewer_email));
CREATE INDEX proverb_votes_by_answer ON proverb_votes (answer_id, decision);
