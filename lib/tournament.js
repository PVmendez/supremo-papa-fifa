// Lógica del torneo, sin dependencias: la usa la API y se puede probar con node.
//
// Dos consolas en paralelo (Sala 1 y Sala 2), tiempos de 3 minutos (~8 minutos por partido).
// Los partidos se juegan por turnos: en cada turno, uno en cada sala, sin jugadores repetidos;
// la sala de cada partido se sortea. Formato liga "tipo Champions":
// al empezar el sorteo se sortean los cruces entre casillas (randomPairs): 3 partidos por casilla si son
// pares y 2 si son impares; después cada uno elige su casilla y juega contra los rivales de esa casilla.
//   4-7   -> todos contra todos y final entre el 1º y el 2º (con tan pocos, las casillas no cambian rivales)
//   8-9   -> liga (8: 3 partidos c/u; 9: 2); 1º y 2º a semis; playoff 3º vs 6º y 4º vs 5º por los otros dos lugares
//   10-12 -> liga (10 y 12: 3 partidos c/u; 11: 2); 1º a 6º a cuartos; playoff 7º vs 10º y 8º vs 9º
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
  const league = f.kind === "rr" ? (n * (n - 1)) / 2 : n % 2 === 0 ? n + n / 2 : n;
  const games = f.kind === "rr" ? n - 1 : n % 2 === 0 ? 3 : 2;
  const plan = knockoutPlan(f);
  const knockout = plan.reduce((sum, r) => sum + r.pairs.length, 0);
  // Turnos con dos salas: los de la liga salen de armarla con números de muestra (las salas no cambian la cuenta).
  const sample = Array.from({ length: n }, (_, i) => i + 1);
  const leagueTurns = scheduleTurns(leagueMatches(sample, f.kind), () => 0).reduce((m, x) => Math.max(m, x.turn), 0);
  const koTurns = plan.reduce((sum, r) => sum + Math.ceil(r.pairs.length / ROOMS), 0);
  const turns = leagueTurns + koTurns;
  return { ...f, n, league, games, chord: f.kind === "ring" && n % 2 === 0 ? chordStep(n) : null,
    matches: league + knockout, rooms: ROOMS, turns, minutes: turns * MATCH_MINUTES };
}

/** Distancia entre casillas del partido "de enfrente": la mitad de la ronda (solo con un número par). */
export function chordStep(n) {
  return n / 2;
}

/** Los cruces "de enfrente" en la ronda de casillas: pares [i, j] de posiciones (desde 0). Con impar, ninguno. */
export function chordPairs(n) {
  if (n % 2 === 1) return [];
  const k = chordStep(n);
  return Array.from({ length: n / 2 }, (_, i) => [i, i + k]);
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
 * Respaldo y estimaciones (los partidos reales salen de randomPairs). ring: los jugadores en el orden de sus casillas;
 * cada uno juega con el de al lado (y el último con el primero) y, si son pares, con el de enfrente (chordPairs).
 * Primero 1v2, 3v4, 5v6…, después 2v3, 4v5… y al final los de enfrente; scheduleTurns arma los turnos.
 */
export function leagueMatches(ring, kind) {
  let pairs;
  if (kind === "rr") {
    pairs = roundRobin(ring).flat();
  } else {
    const edges = ring.map((num, i) => [num, ring[(i + 1) % ring.length]]);
    const chords = chordPairs(ring.length).map(([i, j]) => [ring[i], ring[j]]);
    pairs = [...edges.filter((_, i) => i % 2 === 0), ...edges.filter((_, i) => i % 2 === 1), ...chords];
  }
  return pairs.map(([home, away], i) => ({ stage: "league", home, away, ord: i + 1 }));
}

/** Cuántos cruces tiene la liga con n casillas: todos contra todos (<8), 3 por casilla (par) o 2 (impar). */
export function pairCount(n) {
  if (n < 2) return 0;
  if (n < 8) return (n * (n - 1)) / 2;
  return n % 2 === 0 ? n + n / 2 : n;
}

/**
 * Sorteo de cruces: qué casilla juega contra cuál. Con menos de 8, todos contra todos. Con 8 o más, una
 * ronda al azar entre las casillas (cada una contra dos) y, si son pares, además una pareja al azar para
 * cada una que no repita un cruce de la ronda (3 partidos). slots: los números de casilla.
 * Devuelve pares [a, b] de números de casilla en el orden en que conviene jugarlos.
 */
export function randomPairs(slots, rnd) {
  const n = slots.length;
  const shuffle = (list) => {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  if (n < 2) return [];
  if (n < 8) return roundRobin(shuffle(slots)).flat();
  const order = shuffle(slots);
  const cycle = order.map((a, i) => [a, order[(i + 1) % n]]);
  const pairs = [...cycle.filter((_, i) => i % 2 === 0), ...cycle.filter((_, i) => i % 2 === 1)];
  if (n % 2 === 1) return pairs;
  const key = (a, b) => (a < b ? a + "-" + b : b + "-" + a);
  const used = new Set(cycle.map(([a, b]) => key(a, b)));
  for (let tries = 0; tries < 500; tries++) {
    const s = shuffle(slots);
    const extra = [];
    for (let i = 0; i < n; i += 2) extra.push([s[i], s[i + 1]]);
    if (extra.every(([a, b]) => !used.has(key(a, b)))) return [...pairs, ...extra];
  }
  // Sin suerte (muy improbable con 8 o más): la de enfrente en la ronda sorteada.
  return [...pairs, ...Array.from({ length: n / 2 }, (_, i) => [order[i], order[i + n / 2]])];
}

/** ¿Los cruces guardados sirven para estas casillas? (todas aparecen, la cantidad justa y sin repetidos) */
export function pairsFit(pairs, slots) {
  const set = new Set(slots);
  if (pairs.length !== pairCount(slots.length)) return false;
  const seen = new Set();
  const degree = new Map();
  for (const [a, b] of pairs) {
    if (!set.has(a) || !set.has(b) || a === b) return false;
    const k = a < b ? a + "-" + b : b + "-" + a;
    if (seen.has(k)) return false;
    seen.add(k);
    degree.set(a, (degree.get(a) || 0) + 1);
    degree.set(b, (degree.get(b) || 0) + 1);
  }
  const want = slots.length < 8 ? slots.length - 1 : slots.length % 2 === 0 ? 3 : 2;
  return slots.every((x) => degree.get(x) === want);
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
