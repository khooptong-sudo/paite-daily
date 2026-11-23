-- A new link gets a case-folded key for its pair (both directions the same), so two requests at once cannot both
-- insert it. Existing rows keep NULL: nothing is changed, deleted or rejected, and rows with a NULL key never
-- clash with each other, so existing duplicates cannot make this migration fail.
ALTER TABLE word_links ADD COLUMN pair_key TEXT;
CREATE UNIQUE INDEX word_links_pair_key ON word_links (kind, pair_key) WHERE pair_key IS NOT NULL;
