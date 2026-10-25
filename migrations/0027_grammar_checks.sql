-- Check English: one row per grammar check, so one person cannot run up the model bill.
-- who is a contributor's phone id or a reviewer's email; rows older than a day can go.
CREATE TABLE grammar_checks (
  who TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX grammar_checks_by_who ON grammar_checks (who, at);
