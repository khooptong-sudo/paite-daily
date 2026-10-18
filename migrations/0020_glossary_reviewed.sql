-- Every reviewed item credits the reviewer, not only the sayings. A contributed word
-- remembers the name of the reviewer who approved it, the way a proverb does, so the
-- word list can say "Added by X · Reviewed by Y".
ALTER TABLE glossary ADD COLUMN reviewed_by TEXT;
