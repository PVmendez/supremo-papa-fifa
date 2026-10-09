// Lógica del torneo (grupos + eliminación), sin dependencias: la usa la API y se puede probar con node.
//
// Pensado para UNA consola y unas 3 horas: ningún formato pasa de 15 partidos (~10 minutos cada uno
// con tiempos de 4 minutos). Según la cantidad de jugadores con equipo:
//   4-5   -> 1 grupo todos contra todos; final entre el 1º y el 2º
//   6     -> 2 grupos de 3; los 2 primeros de cada uno a semis
//   7-8   -> 2 grupos (4+3 o 4+4); los 2 primeros de cada uno a semis
//   9-10  -> 3 grupos (3+3+3 o 4+3+3); los ganadores y el mejor 2º a semis
//   11    -> 4 grupos (3+3+3+2, el de 2 juega ida y vuelta); los ganadores a semis
//   12    -> 4 grupos de 3; los ganadores a semis
//   13-16 -> eliminación directa: cruces a un partido y los mejores bombos pasan directo a cuartos
// En la llave (y en los cruces directos), si hay empate se define por penales.

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 16;
export const MATCH_MINUTES = 10;
const GROUP_NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"];
const TIER_ORDER = ["oro", "plata", "bronce", "maldito"];

/**
 * sizes: jugadores por grupo · perGroup: cuántos pasan de cada grupo · best: además pasan los mejores
 * de cierta posición ({ pos, count }) · knockout: tamaño de la llave · direct: grupos de 1 o 2 que son
 * pases directos o cruces a un partido · twoLegs: los grupos de 2 juegan ida y vuelta.
 */
export function formatFor(n) {
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) return null;
  let f;
  if (n <= 5) f = { sizes: [n], perGroup: 2, knockout: 2 };
  else if (n === 6) f = { sizes: [3, 3], perGroup: 2, knockout: 4 };
  else if (n <= 8) f = { sizes: [4, n - 4], perGroup: 2, knockout: 4 };
  else if (n <= 10) f = { sizes: n === 9 ? [3, 3, 3] : [4, 3, 3], perGroup: 1, best: { pos: 1, count: 1 }, knockout: 4 };
  else if (n === 11) f = { sizes: [3, 3, 3, 2], perGroup: 1, knockout: 4, twoLegs: true };
  else if (n === 12) f = { sizes: [3, 3, 3, 3], perGroup: 1, knockout: 4 };
  else {
    const pairs = n - 8;
    f = { sizes: [...Array(8 - pairs).fill(1), ...Array(pairs).fill(2)], perGroup: 1, knockout: 8, direct: true };
  }
  f = { best: null, twoLegs: false, direct: false, ...f, groups: f.sizes.length };
  f.matches = groupMatchCount(f) + (f.knockout - 1);
  f.minutes = f.matches * MATCH_MINUTES;
  return f;
}

function groupMatchCount(f) {
  return f.sizes.reduce((sum, s) => sum + (s === 2 && f.twoLegs ? 2 : (s * (s - 1)) / 2), 0);
}

/**
 * Reparte jugadores en grupos como bombos: se ordenan por bombo de su equipo (al azar dentro del bombo)
 * y se reparten en serpiente, así cada grupo recibe un equipo de cada nivel. En la eliminación directa,
 * los mejores quedan en los grupos de 1 (pasan directo).
 * players: [{ num, tier }]; rand(n) -> entero en [0, n).
 */
export function buildGroups(players, rand) {
  const fmt = formatFor(players.length);
  if (!fmt) return null;
  const shuffled = players.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const tierRank = (p) => { const i = TIER_ORDER.indexOf(p.tier); return i < 0 ? TIER_ORDER.length : i; };
  shuffled.sort((a, b) => tierRank(a) - tierRank(b));

  const groups = fmt.sizes.map((size, i) => ({ name: GROUP_NAMES[i], size, members: [] }));
  let i = 0, forward = true;
  for (const p of shuffled) {
    // Serpiente: A, B, C... y vuelta, salteando los grupos que ya están llenos.
    while (groups[i].members.length >= groups[i].size) {
      if (forward ? i === groups.length - 1 : i === 0) forward = !forward; else i += forward ? 1 : -1;
    }
    groups[i].members.push(p.num);
    if (forward ? i === groups.length - 1 : i === 0) forward = !forward; else i += forward ? 1 : -1;
  }
  return groups.map(({ name, members }) => ({ name, members }));
}

/** Todos contra todos (método del círculo). Devuelve rondas de pares [local, visitante]. */
export function roundRobin(members, twoLegs = false) {
  if (members.length === 2 && twoLegs) return [[[members[0], members[1]]], [[members[1], members[0]]]];
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
 * Partidos de la fase de grupos, en el orden en que se juegan: se intercalan los grupos ronda por ronda
 * para que nadie juegue dos seguidos si se puede.
 */
export function groupMatches(groups, fmt) {
  const perGroup = groups.map((g) => roundRobin(g.members, fmt && fmt.twoLegs));
  const maxRounds = Math.max(0, ...perGroup.map((r) => r.length));
  const out = [];
  for (let r = 0; r < maxRounds; r++) {
    groups.forEach((g, gi) => {
      (perGroup[gi][r] || []).forEach(([home, away]) => out.push({ stage: "group", grp: g.name, home, away }));
    });
  }
  return out.map((m, i) => ({ ...m, ord: i + 1, console: 1 }));
}

const played = (m) => m.hg != null && m.ag != null;

/** Tabla de un grupo: puntos, diferencia de gol, goles a favor y, si siguen iguales, el partido entre ellos. */
export function standings(members, matches) {
  const row = new Map(members.map((num) => [num, { num, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, pts: 0 }]));
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
    if (!m) return 0;
    const winner = winnerOf(m);
    return winner == null ? 0 : winner === x.num ? -1 : 1;
  };
  return [...row.values()]
    .map((r) => ({ ...r, dg: r.gf - r.gc }))
    .sort((x, y) => y.pts - x.pts || y.dg - x.dg || y.gf - x.gf || h2h(x, y) || x.num - y.num);
}

// Para comparar entre grupos de distinto tamaño: promedio por partido.
const perGame = (r) => [r.pts / (r.pj || 1), r.dg / (r.pj || 1), r.gf / (r.pj || 1)];
function compareAcross(x, y) {
  const a = perGame(x), b = perGame(y);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
  return x.num - y.num;
}

/** Clasificados ordenados como cabezas de serie: primeros, después segundos, después los mejores extra. */
export function qualifiers(groups, matches) {
  const fmt = formatFor(groups.reduce((n, g) => n + g.members.length, 0));
  if (fmt.direct) {
    // Cruces directos: pasa el que pasó directo (grupo de 1) o el ganador del cruce, en orden de grupo.
    return groups.map((g) => {
      if (g.members.length === 1) return { num: g.members[0], grp: g.name };
      const m = matches.find((x) => x.grp === g.name);
      return { num: m ? winnerOf(m) : null, grp: g.name };
    });
  }
  const tables = groups.map((g) => ({ grp: g.name, table: standings(g.members, matches.filter((m) => m.grp === g.name)) }));
  const seeds = [];
  for (let pos = 0; pos < fmt.perGroup; pos++) {
    seeds.push(...tables.map((t) => t.table[pos] && { ...t.table[pos], grp: t.grp }).filter(Boolean).sort(compareAcross));
  }
  if (fmt.best) {
    const extra = tables.map((t) => t.table[fmt.best.pos] && { ...t.table[fmt.best.pos], grp: t.grp }).filter(Boolean).sort(compareAcross);
    seeds.push(...extra.slice(0, fmt.best.count));
  }
  return seeds.slice(0, fmt.knockout);
}

/**
 * Primera ronda de la llave: 1 vs último, 2 vs anteúltimo... evitando que se crucen dos del mismo grupo
 * (si pasa, se intercambian rivales con el cruce de al lado). El orden de salida arma la llave:
 * ganadores de 0 y 1 se cruzan, de 2 y 3, etc.
 */
export function firstRound(seeds) {
  const k = seeds.length;
  const pairs = [];
  for (let i = 0; i < k / 2; i++) pairs.push([seeds[i], seeds[k - 1 - i]]);
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0].grp !== pairs[i][1].grp) continue;
    for (let j = 0; j < pairs.length; j++) {
      if (j === i) continue;
      const a = pairs[i], b = pairs[j];
      if (a[0].grp !== b[1].grp && b[0].grp !== a[1].grp) { [a[1], b[1]] = [b[1], a[1]]; break; }
    }
  }
  // Orden de llave clásico para que 1 y 2 solo se puedan cruzar en la final.
  const order = k === 8 ? [0, 3, 1, 2] : k === 4 ? [0, 1] : [0];
  return order.map((i) => pairs[i].map((s) => s.num));
}

export function stagesFor(knockout) {
  return knockout === 8 ? ["qf", "sf", "final"] : knockout === 4 ? ["sf", "final"] : ["final"];
}

/** Ganador de un partido a todo o nada (con penales si empataron), o null si todavía no se jugó. */
export function winnerOf(m) {
  if (!played(m)) return null;
  if (m.hg !== m.ag) return m.hg > m.ag ? m.home : m.away;
  return m.pen_winner === m.home || m.pen_winner === m.away ? m.pen_winner : null;
}

export const isPlayed = played;
