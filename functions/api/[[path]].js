// API del torneo, como Cloudflare Pages Function sobre D1.
//
//   GET  /api/rsvps          -> estado público: nombre y foto solo de quienes ya respondieron
//   GET  /api/me?c=CODE      -> datos del invitado dueño del código
//   POST /api/rsvp           -> { code, status: "yes" | "no" }
//   POST /api/admin/reset    -> { num }  (header x-admin-token) vuelve a "pending"
//
// Sorteo de equipos ("La noche de los sobres"):
//   GET  /api/draw                 -> equipos, quién tiene cada uno, quién falta y el último movimiento
//   POST /api/admin/draw/next      -> abre el sobre del siguiente jugador (al azar entre los confirmados sin equipo)
//   POST /api/admin/draw/steal     -> { thief, victim } el ladrón se queda con el equipo de la víctima y le deja el suyo
//   POST /api/admin/draw/reset     -> borra el sorteo
//
// Torneo (grupos + llave, ver lib/tournament.js):
//   GET  /api/tournament               -> grupos con tabla, partidos, llave y campeón
//   POST /api/admin/tournament/start   -> arma grupos y fixture con los que tienen equipo
//   POST /api/admin/tournament/result  -> { id, hg, ag, pen_winner? } carga (o borra, con null) un resultado
//   POST /api/admin/tournament/reset   -> borra el torneo
//
// Bindings: DB (D1) y la variable secreta ADMIN_TOKEN.

import {
  MIN_PLAYERS, formatFor, buildGroups, groupMatches, standings, qualifiers, firstRound, stagesFor, winnerOf, isPlayed,
} from "../../lib/tournament.js";

const VALID = new Set(["yes", "no"]);

// Los 16 sobres, en 4 bombos. Para cambiar un equipo basta con editar esta lista (el id no puede repetirse).
const TIERS = [
  { id: "oro", name: "Oro" },
  { id: "plata", name: "Plata" },
  { id: "bronce", name: "Bronce" },
  { id: "maldito", name: "Maldito" },
];
const TEAMS = [
  { id: "rma", name: "Real Madrid",        tier: "oro",     colors: ["#FFFFFF", "#FEBE10"] },
  { id: "mci", name: "Manchester City",    tier: "oro",     colors: ["#6CABDD", "#1C2C5B"] },
  { id: "bay", name: "Bayern Múnich",      tier: "oro",     colors: ["#DC052D", "#FFFFFF"] },
  { id: "psg", name: "PSG",                tier: "oro",     colors: ["#004170", "#DA291C"] },
  { id: "bar", name: "Barcelona",          tier: "plata",   colors: ["#A50044", "#004D98"] },
  { id: "liv", name: "Liverpool",          tier: "plata",   colors: ["#C8102E", "#F6EB61"] },
  { id: "ars", name: "Arsenal",            tier: "plata",   colors: ["#EF0107", "#FFFFFF"] },
  { id: "int", name: "Inter",              tier: "plata",   colors: ["#0068A8", "#141414"] },
  { id: "atm", name: "Atlético de Madrid", tier: "bronce",  colors: ["#CB3524", "#FFFFFF"] },
  { id: "juv", name: "Juventus",           tier: "bronce",  colors: ["#141414", "#FFFFFF"] },
  { id: "bvb", name: "Borussia Dortmund",  tier: "bronce",  colors: ["#FDE100", "#141414"] },
  { id: "nap", name: "Napoli",             tier: "bronce",  colors: ["#12A0D7", "#FFFFFF"] },
  { id: "cad", name: "Cádiz",              tier: "maldito", colors: ["#FFE500", "#0045A7"] },
  { id: "lut", name: "Luton Town",         tier: "maldito", colors: ["#F78F1E", "#002D62"] },
  { id: "sal", name: "Salernitana",        tier: "maldito", colors: ["#8A1E2C", "#FFFFFF"] },
  { id: "ips", name: "Ipswich Town",       tier: "maldito", colors: ["#0044A9", "#FFFFFF"] },
];
const TEAM_IDS = new Set(TEAMS.map((t) => t.id));

// Reglas especiales: el campeón defensor (Facundo, #3) abre último y no puede robar;
// el subcampeón (Bruno, #14) abre anteúltimo y tiene doble robo. El resto, un robo cada uno.
const CHAMPION = 3;
const RUNNER_UP = 14;
const OPENS_LAST = [RUNNER_UP, CHAMPION];
const maxSteals = (num) => (num === CHAMPION ? 0 : num === RUNNER_UP ? 2 : 1);
const CODE_RE = /^[A-Z0-9]{4,12}$/;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const publicView = (g) =>
  g.status === "yes"
    ? { num: g.num, status: g.status, name: g.name, photo: g.photo ?? null, team: TEAMS.find((t) => t.id === g.team) || null }
    : g.status === "no"
    ? { num: g.num, status: g.status, name: g.name, photo: g.photo ?? null }
    : { num: g.num, status: "pending" };

const privateView = (g) => ({ num: g.num, name: g.name, photo: g.photo ?? null, status: g.status || "pending" });

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function findByCode(db, raw) {
  const code = String(raw || "").trim().toUpperCase();
  if (!CODE_RE.test(code)) return null;
  return db.prepare("SELECT num, name, photo, status FROM guests WHERE code = ?1").bind(code).first();
}

function setStatus(db, num, status) {
  return db
    .prepare("UPDATE guests SET status = ?1, updated_at = ?2 WHERE num = ?3 RETURNING num, name, photo, status")
    .bind(status, new Date().toISOString(), num)
    .first();
}

// Comparación en tiempo constante para el token de admin.
function sameToken(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Entero al azar en [0, n) con el generador criptográfico del runtime.
function randomIndex(n) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % n;
}

async function drawState(db) {
  const [guests, picks, last] = await db.batch([
    db.prepare("SELECT num, name, photo FROM guests WHERE status = 'yes' ORDER BY num"),
    db.prepare("SELECT num, team, ord, locked, steals FROM picks ORDER BY ord"),
    db.prepare("SELECT id, kind, num, team, victim FROM draw_log ORDER BY id DESC LIMIT 1"),
  ]);
  const confirmed = new Map(guests.results.map((g) => [g.num, g]));
  const taken = new Set();
  const players = picks.results
    .filter((p) => confirmed.has(p.num) && TEAM_IDS.has(p.team))
    .map((p) => {
      taken.add(p.num);
      const g = confirmed.get(p.num);
      return { num: p.num, name: g.name, photo: g.photo ?? null, team: p.team, ord: p.ord,
        locked: !!p.locked, steals: p.steals, maxSteals: maxSteals(p.num) };
    });
  const waiting = guests.results
    .filter((g) => !taken.has(g.num))
    .map((g) => ({ num: g.num, name: g.name, photo: g.photo ?? null }));
  return { tiers: TIERS, teams: TEAMS, players, waiting, last: last.results[0] || null };
}

function logEvent(db, kind, num, team, victim) {
  return db
    .prepare("INSERT INTO draw_log (kind, num, team, victim, at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(kind, num ?? null, team ?? null, victim ?? null, new Date().toISOString());
}

async function drawNext(db) {
  const state = await drawState(db);
  if (!state.waiting.length) return { error: "nobody_waiting" };
  const usedTeams = new Set(state.players.map((p) => p.team));
  const free = TEAMS.filter((t) => !usedTeams.has(t.id));
  if (!free.length) return { error: "no_teams_left" };

  // Primero el resto al azar; después el subcampeón y al final el campeón.
  const regular = state.waiting.filter((g) => !OPENS_LAST.includes(g.num));
  const player = regular.length
    ? regular[randomIndex(regular.length)]
    : state.waiting.find((g) => g.num === OPENS_LAST[0]) || state.waiting[0];
  const team = free[randomIndex(free.length)];
  const ord = state.players.reduce((m, p) => Math.max(m, p.ord), 0) + 1;

  await db.batch([
    db.prepare("DELETE FROM picks WHERE num = ?1").bind(player.num),
    db.prepare("INSERT INTO picks (num, team, ord, updated_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(player.num, team.id, ord, new Date().toISOString()),
    logEvent(db, "draw", player.num, team.id, null),
  ]);
  return { ok: true };
}

async function drawSteal(db, thiefNum, victimNum) {
  if (thiefNum === victimNum) return { error: "same_player" };
  const state = await drawState(db);
  const thief = state.players.find((p) => p.num === thiefNum);
  const victim = state.players.find((p) => p.num === victimNum);
  if (!thief || !victim) return { error: "both_need_team" };
  if (thief.steals >= thief.maxSteals) return { error: "no_steals_left" };
  if (victim.locked) return { error: "team_locked" };

  // team es UNIQUE: se pasa por un valor temporal para intercambiar sin chocar.
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE picks SET team = '__swap' WHERE num = ?1").bind(thiefNum),
    db.prepare("UPDATE picks SET team = ?1, locked = ?2, updated_at = ?3 WHERE num = ?4")
      .bind(thief.team, thief.locked ? 1 : 0, now, victimNum),
    db.prepare("UPDATE picks SET team = ?1, locked = 1, steals = steals + 1, updated_at = ?2 WHERE num = ?3")
      .bind(victim.team, now, thiefNum),
    logEvent(db, "steal", thiefNum, victim.team, victimNum),
  ]);
  return { ok: true };
}

/* ---------- Torneo ---------- */

const CONSOLES = 2;
const teamById = new Map(TEAMS.map((t) => [t.id, t]));

async function tournamentData(db) {
  const [people, groupRows, matchRows] = await db.batch([
    db.prepare("SELECT g.num, g.name, g.photo, p.team FROM guests g JOIN picks p ON p.num = g.num WHERE g.status = 'yes'"),
    db.prepare("SELECT num, grp FROM tgroups ORDER BY grp, num"),
    db.prepare("SELECT id, stage, grp, slot, ord, console, home, away, hg, ag, pen_winner FROM matches ORDER BY ord, id"),
  ]);
  const groups = [];
  for (const r of groupRows.results) {
    let g = groups.find((x) => x.name === r.grp);
    if (!g) groups.push((g = { name: r.grp, members: [] }));
    g.members.push(r.num);
  }
  return { people: people.results, groups, matches: matchRows.results };
}

async function tournamentState(db) {
  const { people, groups, matches } = await tournamentData(db);
  const byNum = new Map(people.map((p) => [p.num, { num: p.num, name: p.name, photo: p.photo ?? null, team: teamById.get(p.team) || null }]));
  const eligible = people.filter((p) => teamById.has(p.team)).length;
  if (!groups.length) {
    return { status: "none", eligible, format: formatFor(eligible), minPlayers: MIN_PLAYERS, players: [...byNum.values()] };
  }
  const total = groups.reduce((n, g) => n + g.members.length, 0);
  const groupGames = matches.filter((m) => m.stage === "group");
  const ko = matches.filter((m) => m.stage !== "group");
  const final = ko.find((m) => m.stage === "final");
  const champion = final ? winnerOf(final) : null;
  const status = champion ? "done" : ko.length ? "knockout" : "groups";
  return {
    status,
    format: formatFor(total),
    players: [...byNum.values()],
    groups: groups.map((g) => ({ name: g.name, table: standings(g.members, groupGames.filter((m) => m.grp === g.name)) })),
    matches,
    champion,
  };
}

async function startTournament(db) {
  const { people, groups } = await tournamentData(db);
  if (groups.length) return { error: "already_started" };
  const players = people.filter((p) => teamById.has(p.team)).map((p) => ({ num: p.num, tier: teamById.get(p.team).tier }));
  const built = buildGroups(players, randomIndex);
  if (!built) return { error: "invalid_player_count" };
  const fixture = groupMatches(built, CONSOLES);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM matches"),
    ...built.flatMap((g) => g.members.map((num) => db.prepare("INSERT INTO tgroups (num, grp) VALUES (?1, ?2)").bind(num, g.name))),
    ...fixture.map((m) => db
      .prepare("INSERT INTO matches (stage, grp, ord, console, home, away, updated_at) VALUES ('group', ?1, ?2, ?3, ?4, ?5, ?6)")
      .bind(m.grp, m.ord, m.console, m.home, m.away, now)),
  ]);
  return { ok: true };
}

/** Crea la llave cuando terminan los grupos y completa cada ronda a medida que hay ganadores. */
async function advanceKnockout(db) {
  const { groups, matches } = await tournamentData(db);
  const groupGames = matches.filter((m) => m.stage === "group");
  if (!groups.length || !groupGames.every(isPlayed)) return;
  const total = groups.reduce((n, g) => n + g.members.length, 0);
  const stages = stagesFor(formatFor(total).knockout);
  const now = new Date().toISOString();
  let ord = matches.reduce((m, x) => Math.max(m, x.ord), 0);
  const stmts = [];

  if (!matches.some((m) => m.stage === stages[0])) {
    firstRound(qualifiers(groups, groupGames)).forEach(([home, away], slot) => {
      ord++;
      stmts.push(db
        .prepare("INSERT INTO matches (stage, slot, ord, console, home, away, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
        .bind(stages[0], slot, ord, (slot % CONSOLES) + 1, home, away, now));
    });
    await db.batch(stmts);
    return advanceKnockout(db);
  }

  for (let s = 1; s < stages.length; s++) {
    const prev = matches.filter((m) => m.stage === stages[s - 1]);
    for (let slot = 0; slot < prev.length / 2; slot++) {
      const a = prev.find((m) => m.slot === slot * 2), b = prev.find((m) => m.slot === slot * 2 + 1);
      const home = a ? winnerOf(a) : null, away = b ? winnerOf(b) : null;
      const cur = matches.find((m) => m.stage === stages[s] && m.slot === slot);
      if (!cur) {
        ord++;
        stmts.push(db
          .prepare("INSERT INTO matches (stage, slot, ord, console, home, away, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
          .bind(stages[s], slot, ord, stages[s] === "final" ? 1 : (slot % CONSOLES) + 1, home, away, now));
      } else if (cur.home !== home || cur.away !== away) {
        // Cambió un resultado anterior: el cruce se rehace y se borra lo que se había cargado.
        stmts.push(db
          .prepare("UPDATE matches SET home = ?1, away = ?2, hg = NULL, ag = NULL, pen_winner = NULL, updated_at = ?3 WHERE id = ?4")
          .bind(home, away, now, cur.id));
      }
    }
  }
  if (stmts.length) { await db.batch(stmts); return advanceKnockout(db); }
}

async function saveResult(db, body) {
  const id = Number(body?.id);
  if (!Number.isInteger(id)) return { error: "invalid_id" };
  const m = await db.prepare("SELECT id, stage, home, away FROM matches WHERE id = ?1").bind(id).first();
  if (!m) return { error: "not_found" };
  if (m.home == null || m.away == null) return { error: "match_not_ready" };
  if (m.stage === "group" && (await db.prepare("SELECT 1 FROM matches WHERE stage != 'group' LIMIT 1").first())) {
    return { error: "knockout_started" };
  }

  const clear = body.hg == null && body.ag == null;
  const goal = (v) => Number.isInteger(v) && v >= 0 && v <= 99;
  if (!clear && (!goal(body.hg) || !goal(body.ag))) return { error: "invalid_score" };
  let pen = null;
  if (!clear && m.stage !== "group" && body.hg === body.ag) {
    pen = Number(body.pen_winner);
    if (pen !== m.home && pen !== m.away) return { error: "pen_winner_required" };
  }
  await db
    .prepare("UPDATE matches SET hg = ?1, ag = ?2, pen_winner = ?3, updated_at = ?4 WHERE id = ?5")
    .bind(clear ? null : body.hg, clear ? null : body.ag, pen, new Date().toISOString(), id)
    .run();
  await advanceKnockout(db);
  return { ok: true };
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
  const method = request.method;
  const db = env.DB;

  try {
    if (method === "GET" && path === "/rsvps") {
      const { results } = await db
        .prepare("SELECT g.num, g.name, g.photo, g.status, p.team FROM guests g LEFT JOIN picks p ON p.num = g.num ORDER BY g.num")
        .all();
      return json(200, { guests: results.map(publicView) });
    }

    if (method === "GET" && path === "/me") {
      const g = await findByCode(db, url.searchParams.get("c"));
      return g ? json(200, privateView(g)) : json(404, { error: "invalid_code" });
    }

    if (method === "POST" && path === "/rsvp") {
      const body = await readJson(request);
      if (!body) return json(400, { error: "invalid_json" });
      const status = String(body.status || "");
      if (!VALID.has(status)) return json(400, { error: "invalid_status" });
      const g = await findByCode(db, body.code);
      if (!g) return json(404, { error: "invalid_code" });
      return json(200, privateView(await setStatus(db, g.num, status)));
    }

    if (method === "POST" && path === "/admin/reset") {
      if (!sameToken(request.headers.get("x-admin-token") || "", env.ADMIN_TOKEN || "")) {
        return json(401, { error: "unauthorized" });
      }
      const body = await readJson(request);
      const num = Number(body?.num);
      if (!Number.isInteger(num)) return json(400, { error: "invalid_num" });
      const g = await setStatus(db, num, "pending");
      return g ? json(200, privateView(g)) : json(404, { error: "not_found" });
    }

    if (method === "GET" && path === "/draw") {
      return json(200, await drawState(db));
    }

    if (method === "POST" && path.startsWith("/admin/draw/")) {
      if (!sameToken(request.headers.get("x-admin-token") || "", env.ADMIN_TOKEN || "")) {
        return json(401, { error: "unauthorized" });
      }
      // Con el torneo armado, el sorteo queda cerrado: los grupos dependen de los equipos.
      if (await db.prepare("SELECT 1 FROM tgroups LIMIT 1").first()) return json(409, { error: "tournament_started" });
      let result;
      if (path === "/admin/draw/next") {
        result = await drawNext(db);
      } else if (path === "/admin/draw/steal") {
        const body = await readJson(request);
        const thief = Number(body?.thief), victim = Number(body?.victim);
        if (!Number.isInteger(thief) || !Number.isInteger(victim)) return json(400, { error: "invalid_num" });
        result = await drawSteal(db, thief, victim);
      } else if (path === "/admin/draw/reset") {
        await db.batch([db.prepare("DELETE FROM picks"), logEvent(db, "reset", null, null, null)]);
        result = { ok: true };
      } else {
        return json(404, { error: "not_found" });
      }
      return result.error ? json(409, result) : json(200, await drawState(db));
    }

    if (method === "GET" && path === "/tournament") {
      return json(200, await tournamentState(db));
    }

    if (method === "POST" && path.startsWith("/admin/tournament/")) {
      if (!sameToken(request.headers.get("x-admin-token") || "", env.ADMIN_TOKEN || "")) {
        return json(401, { error: "unauthorized" });
      }
      let result;
      if (path === "/admin/tournament/start") result = await startTournament(db);
      else if (path === "/admin/tournament/result") result = await saveResult(db, await readJson(request));
      else if (path === "/admin/tournament/reset") {
        await db.batch([db.prepare("DELETE FROM matches"), db.prepare("DELETE FROM tgroups")]);
        result = { ok: true };
      } else return json(404, { error: "not_found" });
      return result.error ? json(409, result) : json(200, await tournamentState(db));
    }

    return json(404, { error: "not_found" });
  } catch (err) {
    console.error(err);
    return json(500, { error: "server_error" });
  }
}
