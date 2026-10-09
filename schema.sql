CREATE TABLE IF NOT EXISTS guests (
  num        INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  photo      TEXT,
  code       TEXT    NOT NULL UNIQUE,
  status     TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'yes', 'no')),
  updated_at TEXT
);

-- Sorteo de equipos: un equipo por jugador, en el orden en que los eligieron.
-- locked y steals quedaron de la versión con robos y no se usan.
CREATE TABLE IF NOT EXISTS picks (
  num        INTEGER PRIMARY KEY,
  team       TEXT    NOT NULL UNIQUE,
  ord        INTEGER NOT NULL,
  locked     INTEGER NOT NULL DEFAULT 0,
  steals     INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

-- Torneo: grupo de cada jugador y todos los partidos (grupos y llave).
-- En la llave, home/away quedan NULL hasta que se definen los cruces; pen_winner solo si empataron.
CREATE TABLE IF NOT EXISTS tgroups (
  num INTEGER PRIMARY KEY,
  grp TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  stage      TEXT    NOT NULL CHECK (stage IN ('group', 'qf', 'sf', 'final')),
  grp        TEXT,
  slot       INTEGER NOT NULL DEFAULT 0,
  ord        INTEGER NOT NULL DEFAULT 0,
  console    INTEGER,
  home       INTEGER,
  away       INTEGER,
  hg         INTEGER,
  ag         INTEGER,
  pen_winner INTEGER,
  updated_at TEXT
);

-- Sorteo por penales: la fila de pateadores y lo que va pasando (para animarlo en todas las pantallas).
CREATE TABLE IF NOT EXISTS penalty_queue (
  num INTEGER PRIMARY KEY,
  pos INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS penalty_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  kind   TEXT    NOT NULL CHECK (kind IN ('start', 'shot', 'pick', 'reset')),
  num    INTEGER,
  zone   TEXT,
  dive   TEXT,
  result TEXT,
  team   TEXT,
  at     TEXT    NOT NULL
);
