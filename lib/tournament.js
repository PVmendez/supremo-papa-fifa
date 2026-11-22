// Lógica del torneo, sin dependencias: la usa la API y se puede probar con node.
//
// Dos consolas en paralelo (Sala 1 y Sala 2), tiempos de 3 minutos (~8 minutos por partido).
// Los partidos se juegan por turnos: en cada turno, uno en cada sala, sin jugadores repetidos;
// la sala de cada partido se sortea. Formato liga "tipo Champions":
// en el sorteo cada uno elige una casilla de una ronda y juega contra las dos casillas vecinas.
//   4-7   -> todos contra todos y final entre el 1º y el 2º (con tan pocos, las casillas no cambian rivales)
//   8-9   -> liga de 2 partidos; 1º y 2º a semis; playoff 3º vs 6º y 4º vs 5º por los otros dos lugares
//   10-12 -> liga de 2 partidos; 1º a 6º a cuartos; playoff 7º vs 10º y 8º vs 9º por los otros dos lugares
// Tabla: puntos, resultado entre ellos, diferencia de gol, goles a favor y, si siguen iguales, al azar.
// Playoff y llave a un partido; si hay empate, penales.

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 12;
export const MATCH_MINUTES = 8;
export const ROOMS = 2;

// En la llave, un número es un puesto de la tabla y { w: [etapa, cruce] } es el ganador de ese cruce.
const W = (stage, slot) => ({ w: [stage, slot] });

export function formatFor(n) {
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) return null;
  let f;
  if (n <= 7) {
    f = { kind: "rr", direct: 2, playoff: [], rounds: { final: [[1, 2]] } };
  } else if (n <= 9) {
    f = { kind: "ring", direct: 2, playoff: [[3, 6], [4, 5]], rounds: {
      sf: [[1, W("po", 1)], [2, W("po", 0)]],
      final: [[W("sf", 0), W("sf", 1)]],
    } };
  } else {
    f = { kind: "ring", direct: 6, playoff: [[7, 10], [8, 9]], rounds: {
      qf: [[1, W("po", 1)], [4, 5], [2, W("po", 0)], [3, 6]],
      sf: [[W("qf", 0), W("qf", 1)], [W("qf", 2), W("qf", 3)]],
      final: [[W("sf", 0), W("sf", 1)]],
    } };
  }
  const league = f.kind === "rr" ? (n * (n - 1)) / 2 : n;
  const plan = knockoutPlan(f);
  const knockout = plan.reduce((sum, r) => sum + r.pairs.length, 0);
  // Turnos con dos salas: los de la liga salen de armarla con números de muestra (las salas no cambian la cuenta).
  const sample = Array.from({ length: n }, (_, i) => i + 1);
  const leagueTurns = scheduleTurns(leagueMatches(sample, f.kind), () => 0).reduce((m, x) => Math.max(m, x.turn), 0);
  const koTurns = plan.reduce((sum, r) => sum + Math.ceil(r.pairs.length / ROOMS), 0);
  const turns = leagueTurns + koTurns;
  return { ...f, n, league, matches: league + knockout, rooms: ROOMS, turns, minutes: turns * MATCH_MINUTES };
}

/**
 * Reparte partidos en turnos de hasta ROOMS partidos simultáneos, sin que nadie juegue dos a la vez.
 * Respeta el orden en lo posible y prefiere no poner a alguien que acaba de jugar en el turno anterior.
 * En cada turno sortea qué partido va a cada sala. rnd(n) devuelve un entero al azar en [0, n).
 * Devuelve los mismos partidos con { turn, room }, ordenados por turno y sala.
 */
export function scheduleTurns(matches, rnd) {
  const left = matches.slice();
  const out = [];
  let prev = new Set(), turn = 0;
  const players = (m) => [m.home, m.away].filter((x) => x != null);
  const takeFirst = (ok) => {
    const i = left.findIndex(ok);
    return i < 0 ? null : left.splice(i, 1)[0];
  };
  while (left.length) {
    turn++;
    const busy = new Set();
    const picked = [];
    while (picked.length < ROOMS && left.length) {
      const free = (m) => players(m).every((p) => !busy.has(p));
      const rested = (m) => players(m).every((p) => !prev.has(p));
      const m = takeFirst((x) => free(x) && rested(x)) || takeFirst(free);
      if (!m) break;
      players(m).forEach((p) => busy.add(p));
      picked.push(m);
    }
    // Sorteo de salas dentro del turno: se mezclan las salas y cada partido se lleva una.
    const rooms = Array.from({ length: ROOMS }, (_, i) => i + 1);
    for (let i = rooms.length - 1; i > 0; i--) {
      const j = rnd(i + 1);
      [rooms[i], rooms[j]] = [rooms[j], rooms[i]];
    }
    picked.forEach((m, i) => out.push({ ...m, turn, room: rooms[i] }));
    prev = busy;
  }
  return out.sort((a, b) => a.turn - b.turn || a.room - b.room);
}

/** Las rondas de eliminación en el orden en que se juegan: [{ stage, pairs }]. */
export function knockoutPlan(fmt) {
  const out = [];
  if (fmt.playoff.length) out.push({ stage: "po", pairs: fmt.playoff });
  for (const stage of ["qf", "sf", "final"]) if (fmt.rounds[stage]) out.push({ stage, pairs: fmt.rounds[stage] });
  return out;
}

/** En qué zona termina cada puesto de la tabla: directo a la llave, playoff o afuera. */
export function zoneOf(fmt, pos) {
  if (pos <= fmt.direct) return "direct";
  if (fmt.playoff.some((pair) => pair.includes(pos))) return "po";
  return "out";
}

/** Todos contra todos (método del círculo). Devuelve rondas de pares [local, visitante]. */
export function roundRobin(members) {
  const list = members.slice();
  if (list.length % 2) list.push(null);
  const n = list.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i], b = list[n - 1 - i];
      if (a != null && b != null) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop());
  }
  return rounds;
}

/**
 * Partidos de la liga en el orden en que se juegan. ring: los jugadores en el orden de sus casillas;
 * cada uno juega con el de al lado (y el último con el primero). Primero 1v2, 3v4, 5v6… y después
 * 2v3, 4v5…, así nadie juega dos seguidos.
 */
export function leagueMatches(ring, kind) {
  let pairs;
  if (kind === "rr") {
    pairs = roundRobin(ring).flat();
  } else {
    const edges = ring.map((num, i) => [num, ring[(i + 1) % ring.length]]);
    pairs = [...edges.filter((_, i) => i % 2 === 0), ...edges.filter((_, i) => i % 2 === 1)];
  }
  return pairs.map(([home, away], i) => ({ stage: "league", home, away, ord: i + 1 }));
}

const played = (m) => m.hg != null && m.ag != null;

/** Ganador de un partido a todo o nada (con penales si empataron), o null si todavía no se jugó. */
export function winnerOf(m) {
  if (!played(m)) return null;
  if (m.hg !== m.ag) return m.hg > m.ag ? m.home : m.away;
  return m.pen_winner === m.home || m.pen_winner === m.away ? m.pen_winner : null;
}

// "Al azar" pero estable: siempre el mismo orden para los mismos jugadores, así la tabla no salta.
const coin = (num) => (Math.imul(num, 2654435761) >>> 0) % 1009;

/** Tabla de la liga: puntos, resultado entre ellos, diferencia de gol, goles a favor y al azar. */
export function standings(nums, matches) {
  const row = new Map(nums.map((num) => [num, { num, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, pts: 0 }]));
  const games = matches.filter((m) => played(m) && row.has(m.home) && row.has(m.away));
  for (const m of games) {
    const h = row.get(m.home), a = row.get(m.away);
    h.pj++; a.pj++;
    h.gf += m.hg; h.gc += m.ag; a.gf += m.ag; a.gc += m.hg;
    if (m.hg > m.ag) { h.g++; a.p++; h.pts += 3; }
    else if (m.hg < m.ag) { a.g++; h.p++; a.pts += 3; }
    else { h.e++; a.e++; h.pts++; a.pts++; }
  }
  const h2h = (x, y) => {
    const m = games.find((g) => (g.home === x.num && g.away === y.num) || (g.home === y.num && g.away === x.num));
    if (!m || m.hg === m.ag) return 0;
    return (m.hg > m.ag ? m.home : m.away) === x.num ? -1 : 1;
  };
  return [...row.values()]
    .map((r) => ({ ...r, dg: r.gf - r.gc }))
    .sort((x, y) => y.pts - x.pts || h2h(x, y) || y.dg - x.dg || y.gf - x.gf || coin(x.num) - coin(y.num));
}

/**
 * Arma la llave a partir de la tabla y de los cruces ya jugados. Devuelve las rondas con local y
 * visitante resueltos (null mientras no se sepa). byStageSlot(stage, slot) -> partido guardado o null.
 */
export function resolveKnockout(fmt, table, byStageSlot) {
  const out = [];
  const pick = (item) => {
    if (typeof item === "number") return table[item - 1] ? table[item - 1].num : null;
    const m = byStageSlot(item.w[0], item.w[1]);
    return m ? winnerOf(m) : null;
  };
  for (const round of knockoutPlan(fmt)) {
    round.pairs.forEach(([a, b], slot) => out.push({ stage: round.stage, slot, home: pick(a), away: pick(b) }));
  }
  return out;
}

export const isPlayed = played;
