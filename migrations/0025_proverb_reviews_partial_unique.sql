-- An undone review used to keep its slot, so the same reviewer could never
-- review the same line twice: the INSERT OR IGNORE hit the old row silently and
-- the count then ran without them. Undone rows must not reserve the slot.
DROP INDEX IF EXISTS proverb_reviews_once;

CREATE UNIQUE INDEX proverb_reviews_once
  ON proverb_reviews (proverb_id, COALESCE(answer_id, 0), lower(reviewer_email), decision)
  WHERE undone_at IS NULL;
