-- Lines visitors asked the chat for: 0 not yet looked at, 1 queued for translation,
-- 2 turned down (not a clean everyday line). Only 0 rows are sent to be checked.
ALTER TABLE chat_wants ADD COLUMN vetted INTEGER NOT NULL DEFAULT 0;

-- The chat's AI choices, cached by the asked line's key: which verified pair (by its
-- English key) means the same, or NULL for none. Re-checked when that pair stops being verified.
CREATE TABLE chat_ai (
  q_key TEXT PRIMARY KEY,
  pair_key TEXT,
  at INTEGER NOT NULL
);
