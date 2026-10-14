ALTER TABLE sentences ADD COLUMN direction TEXT NOT NULL DEFAULT 'en2pai' CHECK (direction IN ('en2pai', 'pai2en'));
ALTER TABLE sentences ADD COLUMN source_answer_id INTEGER;
ALTER TABLE sentences ADD COLUMN paite_prompt TEXT;
CREATE UNIQUE INDEX sentences_source_answer ON sentences (source_answer_id);
