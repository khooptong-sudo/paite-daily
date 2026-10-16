-- A reviewer can save answers that are neither wrong nor the exact answer: a 'variant' review.
-- SQLite cannot widen a CHECK constraint in place, so the table is rebuilt.
CREATE TABLE reviews_new (
  id INTEGER PRIMARY KEY,
  sentence_id INTEGER NOT NULL REFERENCES sentences (id),
  reviewer_email TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accept', 'reject', 'retire', 'variant')),
  accepted_answer_id INTEGER REFERENCES answers (id),
  final_paite TEXT,
  register TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  undone_at TEXT,
  answer_ids TEXT
);

INSERT INTO reviews_new (id, sentence_id, reviewer_email, decision, accepted_answer_id, final_paite, register, note, created_at, undone_at, answer_ids)
  SELECT id, sentence_id, reviewer_email, decision, accepted_answer_id, final_paite, register, note, created_at, undone_at, answer_ids FROM reviews;

DROP TABLE reviews;

ALTER TABLE reviews_new RENAME TO reviews;
