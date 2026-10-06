PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  created_at    INTEGER NOT NULL
);

-- token_hash is sha256 of the cookie value, so a leaked database can't be used to log in.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT 'lavender',
  new_per_day INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_user_parent ON folders(user_id, parent_id);

CREATE TABLE IF NOT EXISTS cards (
  id               INTEGER PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id        INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  front            TEXT NOT NULL DEFAULT '',
  back             TEXT NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  -- scheduling
  state            TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'learning', 'review', 'relearning')),
  ease             REAL NOT NULL DEFAULT 2.5,
  interval_days    INTEGER NOT NULL DEFAULT 0,
  due_at           INTEGER NOT NULL,
  step             INTEGER NOT NULL DEFAULT 0,
  lapses           INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cards_queue ON cards(user_id, folder_id, state, due_at);

CREATE TABLE IF NOT EXISTS card_images (
  id         INTEGER PRIMARY KEY,
  card_id    INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  side       TEXT NOT NULL CHECK (side IN ('front', 'back')),
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_card_images_card ON card_images(card_id);

-- Insert-only. No foreign key on card_id, so history survives deleting a card.
CREATE TABLE IF NOT EXISTS review_log (
  id              INTEGER PRIMARY KEY,
  card_id         INTEGER NOT NULL,
  user_id         INTEGER NOT NULL,
  rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  reviewed_at     INTEGER NOT NULL,
  state_before    TEXT NOT NULL,
  interval_before INTEGER NOT NULL,
  interval_after  INTEGER NOT NULL,
  ease_after      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_log_user_time ON review_log(user_id, reviewed_at);

CREATE TRIGGER IF NOT EXISTS review_log_no_update BEFORE UPDATE ON review_log
BEGIN SELECT RAISE(ABORT, 'review_log is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS review_log_no_delete BEFORE DELETE ON review_log
BEGIN SELECT RAISE(ABORT, 'review_log is insert-only'); END;
