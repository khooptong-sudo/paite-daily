-- Where a word submission came from: the free "Add a Word" box ('word'), or the "Give the Meaning"
-- box that shows a word from the list ('meaning').
ALTER TABLE word_submissions ADD COLUMN source TEXT NOT NULL DEFAULT 'word';
