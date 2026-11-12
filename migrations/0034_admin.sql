-- The admin dashboard (/admin): its own accounts, kept apart from reviewer sign-in.
-- The super-user is whoever OWNER_EMAIL names; owners add and remove admins here.
CREATE TABLE admins (
  email TEXT PRIMARY KEY,
  added_by TEXT NOT NULL,
  added_at INTEGER NOT NULL
);

CREATE TABLE admin_passwords (
  email TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Only the SHA-256 of a session or link token is stored.
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX admin_sessions_email ON admin_sessions (email);

CREATE TABLE admin_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE admin_attempts (
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX admin_attempts_key ON admin_attempts (key, at);

-- The AI that serves the site: provider, endpoint, model, and the API key encrypted with
-- AES-GCM (key derived from SESSION_SECRET). key_hint is the last four characters, for display.
CREATE TABLE ai_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  key_cipher TEXT NOT NULL,
  key_iv TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
