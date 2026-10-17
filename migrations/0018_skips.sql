-- A reviewer can pass on a sentence for a while. It stays pending for everyone
-- else; claimNext just stops offering it to the same person until the skip runs out.
CREATE TABLE skips (
  sentence_id INTEGER NOT NULL REFERENCES sentences (id),
  reviewer_email TEXT NOT NULL,
  until INTEGER NOT NULL,
  PRIMARY KEY (sentence_id, reviewer_email)
);
