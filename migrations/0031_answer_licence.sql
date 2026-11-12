-- The licence each contributor agreed to when they sent the answer, so the export labels a line by what its author was told,
-- not by the night it happened to be exported.
-- Until commit 152c016 (2026-10-21 18:47:31 UTC) the form said "given to everyone, free (public domain)": CC0 1.0.
-- From then on it says "free for everyone to use, with credit (CC BY 4.0)". The exact deploy time is not on record, so
-- answers after the commit time get CC BY, the label that waives nothing the contributor did not agree to waive.
ALTER TABLE answers ADD COLUMN licence TEXT NOT NULL DEFAULT 'CC-BY-4.0' CHECK (licence IN ('CC0-1.0', 'CC-BY-4.0'));
UPDATE answers SET licence = 'CC0-1.0' WHERE created_at < '2026-10-21 18:47:31';
