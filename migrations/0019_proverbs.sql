-- Proverbs and idioms: a fixed pair — a Paite line and an English line — with an
-- explainer saying what the saying means. A Paite proverb arrives with its
-- explainer in Paite (explainer_en optional); an English idiom may arrive on its
-- own, status 'open', and wait for a Paite rendering from a contributor.
CREATE TABLE proverbs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'proverb' CHECK (kind IN ('proverb', 'idiom')),
  paite TEXT,
  english TEXT,
  explainer TEXT,
  explainer_en TEXT,
  entered_from TEXT NOT NULL CHECK (entered_from IN ('pai2en', 'en2pai')),
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('open', 'pending', 'live', 'hidden')),
  source TEXT NOT NULL DEFAULT 'seed',
  submitted_by TEXT,
  contributor_name TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (paite IS NOT NULL OR english IS NOT NULL)
);

-- The same saying must not arrive twice, from either direction.
CREATE UNIQUE INDEX proverbs_paite_unique ON proverbs (lower(paite)) WHERE paite IS NOT NULL;
CREATE UNIQUE INDEX proverbs_english_unique ON proverbs (lower(english)) WHERE english IS NOT NULL;
CREATE INDEX proverbs_pool ON proverbs (status, entered_from);

-- Candidate Paite renderings for an English idiom, reviewed like answers.
CREATE TABLE proverb_answers (
  id INTEGER PRIMARY KEY,
  proverb_id INTEGER NOT NULL REFERENCES proverbs (id),
  paite TEXT NOT NULL,
  explainer TEXT,
  explainer_en TEXT,
  phone_id TEXT NOT NULL,
  contributor_name TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX proverb_answers_by_proverb ON proverb_answers (proverb_id, status);
