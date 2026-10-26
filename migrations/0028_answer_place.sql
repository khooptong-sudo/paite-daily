-- Where you learned it: an optional village or town per answer, shown publicly only as a
-- count per place on /places, never beside a name.
ALTER TABLE answers ADD COLUMN place TEXT;
CREATE INDEX answers_by_place ON answers (place) WHERE place IS NOT NULL;
