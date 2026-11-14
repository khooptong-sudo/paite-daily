-- The answer as shown (JSON of parts and sources), so a reviewer can see what a "No" vote was about.
ALTER TABLE kb_asks ADD COLUMN answer TEXT;
-- Unanswered questions a reviewer has dealt with. Asked again after dismissed_at, it comes back.
CREATE TABLE kb_ask_dismissed (q_key TEXT PRIMARY KEY, dismissed_by TEXT NOT NULL, dismissed_at INTEGER NOT NULL);
