-- When an accepted clip was copied to audio/ in the dataset repository. NULL: not there (never sent, or taken down after an undo or reject).
ALTER TABLE recordings ADD COLUMN exported_at TEXT;
