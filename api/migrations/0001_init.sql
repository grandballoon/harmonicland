-- Accounts and their saved sections (src/core.ts explains the shape).
-- A user's id is the SHA-256 of their key; the key itself is never stored.
-- A sign-in service later adds its own columns or tables beside these and
-- claims an anonymous id's rows.
CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL  -- ms since the epoch
);

-- One row per user per score: that score's sections, as the app's JSON.
CREATE TABLE sections (
  user_id    TEXT NOT NULL REFERENCES users (id),
  score_key  TEXT NOT NULL,
  body       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,  -- ms since the epoch
  PRIMARY KEY (user_id, score_key)
);
