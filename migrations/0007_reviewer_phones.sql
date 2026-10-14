CREATE TABLE reviewer_phones (
  phone_id TEXT PRIMARY KEY,
  reviewer_email TEXT NOT NULL,
  linked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
