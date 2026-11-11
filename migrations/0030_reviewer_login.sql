-- Reviewer sign-in with email and password, in place of Cloudflare Access.
-- Passwords sit apart from reviewers because a reviewer may come from the REVIEWERS secret or OWNER_EMAIL and have no row there.
CREATE TABLE reviewer_passwords (
  email TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Only the SHA-256 of a session or link token is stored, so a copy of the database signs nobody in.
CREATE TABLE reviewer_sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX reviewer_sessions_email ON reviewer_sessions (email);
CREATE TABLE reviewer_password_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
-- One row per failed sign-in or link request; key is 'login:<email>', 'login-ip:<hash>', 'link:<email>' or 'link-ip:<hash>'.
CREATE TABLE reviewer_login_attempts (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX reviewer_login_attempts_key ON reviewer_login_attempts (key, at);
