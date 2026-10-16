-- A reviewer may correct a word that is already in the list. The row remembers who fixed it and when.
ALTER TABLE glossary ADD COLUMN edited_by TEXT;
ALTER TABLE glossary ADD COLUMN edited_at TEXT;
