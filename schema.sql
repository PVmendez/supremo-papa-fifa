CREATE TABLE IF NOT EXISTS guests (
  num        INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  photo      TEXT,
  code       TEXT    NOT NULL UNIQUE,
  status     TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'yes', 'no')),
  updated_at TEXT
);

-- Sorteo de equipos ("La noche de los sobres"). Un equipo por jugador.
-- locked = el equipo fue robado y ya no se puede volver a robar. steals = robos que usó ese jugador.
CREATE TABLE IF NOT EXISTS picks (
  num        INTEGER PRIMARY KEY,
  team       TEXT    NOT NULL UNIQUE,
  ord        INTEGER NOT NULL,
  locked     INTEGER NOT NULL DEFAULT 0,
  steals     INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

-- Lo que va pasando en el sorteo, para que todas las pantallas animen el último movimiento.
CREATE TABLE IF NOT EXISTS draw_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  kind   TEXT    NOT NULL CHECK (kind IN ('draw', 'steal', 'reset')),
  num    INTEGER,
  team   TEXT,
  victim INTEGER,
  at     TEXT    NOT NULL
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
