// Lógica del torneo (grupos + eliminación), sin dependencias: la usa la API y se puede probar con node.
//
// Formato según la cantidad de jugadores con equipo (mínimo 4):
//   4-5   -> 1 grupo, los 4 primeros a semis
//   6-8   -> 2 grupos, los 2 primeros de cada uno a semis
//   9-11  -> 3 grupos, los 2 primeros + los 2 mejores terceros a cuartos
//   12-16 -> 4 grupos, los 2 primeros de cada uno a cuartos
// Grupos todos contra todos a un partido. En la llave, si hay empate se define por penales.

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 16;
const GROUP_NAMES = ["A", "B", "C", "D"];
const TIER_ORDER = ["oro", "plata", "bronce", "maldito"];

export function formatFor(n) {
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) return null;
  if (n <= 5) return { groups: 1, perGroup: 4, bestThirds: 0, knockout: 4 };
  if (n <= 8) return { groups: 2, perGroup: 2, bestThirds: 0, knockout: 4 };
  if (n <= 11) return { groups: 3, perGroup: 2, bestThirds: 2, knockout: 8 };
  return { groups: 4, perGroup: 2, bestThirds: 0, knockout: 8 };
}

/**
 * Reparte jugadores en grupos como bombos: se ordenan por bombo de su equipo (al azar dentro del bombo)
 * y se reparten en serpiente, así cada grupo recibe un equipo de cada nivel.
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

  const groups = GROUP_NAMES.slice(0, fmt.groups).map((name) => ({ name, members: [] }));
  shuffled.forEach((p, i) => {
    const round = Math.floor(i / fmt.groups), pos = i % fmt.groups;
    const g = round % 2 === 0 ? pos : fmt.groups - 1 - pos;
    groups[g].members.push(p.num);
  });
  return groups;
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
 * Partidos de la fase de grupos, intercalando grupos ronda por ronda para que nadie juegue dos seguidos
 * si se puede, y asignando consola 1 / 2 en orden.
 */
export function groupMatches(groups, consoles = 2) {
  const perGroup = groups.map((g) => roundRobin(g.members));
  const maxRounds = Math.max(...perGroup.map((r) => r.length));
  const out = [];
  for (let r = 0; r < maxRounds; r++) {
    groups.forEach((g, gi) => {
      (perGroup[gi][r] || []).forEach(([home, away]) => out.push({ stage: "group", grp: g.name, home, away }));
    });
  }
  return out.map((m, i) => ({ ...m, ord: i + 1, console: (i % consoles) + 1 }));
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
    if (!m || m.hg === m.ag) return 0;
    const winner = m.hg > m.ag ? m.home : m.away;
    return winner === x.num ? -1 : 1;
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

/** Clasificados ordenados como cabezas de serie: primeros, después segundos, después mejores terceros. */
export function qualifiers(groups, matches) {
  const fmt = formatFor(groups.reduce((n, g) => n + g.members.length, 0));
  const tables = groups.map((g) => ({ grp: g.name, table: standings(g.members, matches.filter((m) => m.grp === g.name)) }));
  const seeds = [];
  for (let pos = 0; pos < fmt.perGroup; pos++) {
    const tier = tables.map((t) => t.table[pos] && { ...t.table[pos], grp: t.grp }).filter(Boolean);
    seeds.push(...tier.sort(compareAcross));
  }
  if (fmt.bestThirds) {
    const thirds = tables.map((t) => t.table[2] && { ...t.table[2], grp: t.grp }).filter(Boolean).sort(compareAcross);
    seeds.push(...thirds.slice(0, fmt.bestThirds));
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
  const order = k === 8 ? [0, 3, 1, 2] : [0, 1];
  return order.map((i) => pairs[i].map((s) => s.num));
}

export function stagesFor(knockout) {
  return knockout === 8 ? ["qf", "sf", "final"] : ["sf", "final"];
}

/** Ganador de un partido de llave (con penales si empataron), o null si todavía no se jugó. */
export function winnerOf(m) {
  if (!played(m)) return null;
  if (m.hg !== m.ag) return m.hg > m.ag ? m.home : m.away;
  return m.pen_winner === m.home || m.pen_winner === m.away ? m.pen_winner : null;
}

export const isPlayed = played;
