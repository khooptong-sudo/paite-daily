-- Credit the contributor who suggested a word. Null when they gave no name.
ALTER TABLE glossary ADD COLUMN contributor_name TEXT;
UPDATE glossary SET contributor_name = (
  SELECT w.contributor_name FROM word_submissions w
  WHERE w.status = 'approved' AND lower(w.paite) = lower(glossary.paite) AND lower(w.english) = lower(glossary.english)
  ORDER BY w.id LIMIT 1
) WHERE source = 'contributed';
