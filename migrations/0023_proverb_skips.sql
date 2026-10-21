-- Skipping. A reviewer can pass on a saying without deciding it. It leaves their
-- own queue for two hours and stays open to everyone else, which is the rule the
-- sentence lane already applies to a skipped card.
CREATE TABLE proverb_skips (
  proverb_id INTEGER NOT NULL REFERENCES proverbs (id),
  reviewer_email TEXT NOT NULL,
  until INTEGER NOT NULL
);

CREATE UNIQUE INDEX proverb_skips_once ON proverb_skips (proverb_id, lower(reviewer_email));
