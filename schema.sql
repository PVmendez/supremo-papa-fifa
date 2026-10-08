CREATE TABLE IF NOT EXISTS guests (
  num        INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  photo      TEXT,
  code       TEXT    NOT NULL UNIQUE,
  status     TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'yes', 'no')),
  updated_at TEXT
);
