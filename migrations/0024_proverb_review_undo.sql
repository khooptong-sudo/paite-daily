-- Undo needs to know what a review touched, and whether it was the review that
-- published the saying. The sentence lane keeps answer_ids on `reviews` for the
-- same reason; this mirrors it, and adds `published` because a saying can be
-- published by the second acceptance and has to be put back when that is undone.
ALTER TABLE proverb_reviews ADD COLUMN answer_ids TEXT;
ALTER TABLE proverb_reviews ADD COLUMN published INTEGER NOT NULL DEFAULT 0;
