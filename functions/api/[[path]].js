// API del torneo, como Cloudflare Pages Function sobre D1.
//
//   GET  /api/rsvps          -> estado público: nombre y foto solo de quienes ya respondieron
//   GET  /api/me?c=CODE      -> datos del invitado dueño del código
//   POST /api/rsvp           -> { code, status: "yes" | "no" }
//   POST /api/admin/reset    -> { num }  (header x-admin-token) vuelve a "pending"
//   POST /api/admin/check    -> 200 si el código del organizador (header x-admin-token) es correcto
//
// Sorteo de equipos por penales (ver lib/penalty.js):
//   GET  /api/draw            -> equipos, quién tiene cada uno, la fila de pateadores, a quién le toca y el último movimiento
//   POST /api/draw/start      -> (organizador) arma la fila al azar con los confirmados
//   POST /api/draw/shoot      -> { zone, expect } patea el que está primero en la fila
//   POST /api/draw/pick       -> { team, expect } el que hizo el gol elige equipo
//   POST /api/admin/draw/reset -> borra el sorteo
// shoot y pick los puede hacer el organizador (x-admin-token) o el propio jugador con su código (x-guest-code).
// expect es el número del jugador que la pantalla cree que está pateando, para no patear por otro.
//
// Torneo (grupos + llave, ver lib/tournament.js):
//   GET  /api/tournament               -> grupos con tabla, partidos, llave y campeón
//   POST /api/admin/tournament/start   -> arma grupos y fixture con los que tienen equipo
//   POST /api/admin/tournament/result  -> { id, hg, ag, pen_winner? } carga (o borra, con null) un resultado
//   POST /api/admin/tournament/reset   -> borra el torneo
//
// Bindings: DB (D1) y la variable secreta ADMIN_TOKEN.

import { shoot, ZONES } from "../../lib/penalty.js";
import {
  MIN_PLAYERS, formatFor, buildGroups, groupMatches, standings, qualifiers, firstRound, stagesFor, winnerOf, isPlayed,
} from "../../lib/tournament.js";

const VALID = new Set(["yes", "no"]);

// Los 16 equipos, en 4 bombos. Para cambiar un equipo basta con editar esta lista (el id no puede repetirse).
// El escudo de cada uno está en web/img/escudos/<id>.png.
const TIERS = [
  { id: "oro", name: "Oro" },
  { id: "plata", name: "Plata" },
  { id: "bronce", name: "Bronce" },
  { id: "maldito", name: "Maldito" },
];
const TEAMS = [
  { id: "rma", name: "Real Madrid",        tier: "oro",     colors: ["#FFFFFF", "#FEBE10"], logo: "img/escudos/rma.png" },
  { id: "mci", name: "Manchester City",    tier: "oro",     colors: ["#6CABDD", "#1C2C5B"], logo: "img/escudos/mci.png" },
  { id: "bay", name: "Bayern Múnich",      tier: "oro",     colors: ["#DC052D", "#FFFFFF"], logo: "img/escudos/bay.png" },
  { id: "psg", name: "PSG",                tier: "oro",     colors: ["#004170", "#DA291C"], logo: "img/escudos/psg.png" },
  { id: "bar", name: "Barcelona",          tier: "plata",   colors: ["#A50044", "#004D98"], logo: "img/escudos/bar.png" },
  { id: "liv", name: "Liverpool",          tier: "plata",   colors: ["#C8102E", "#F6EB61"], logo: "img/escudos/liv.png" },
  { id: "ars", name: "Arsenal",            tier: "plata",   colors: ["#EF0107", "#FFFFFF"], logo: "img/escudos/ars.png" },
  { id: "int", name: "Inter",              tier: "plata",   colors: ["#0068A8", "#141414"], logo: "img/escudos/int.png" },
  { id: "atm", name: "Atlético de Madrid", tier: "bronce",  colors: ["#CB3524", "#FFFFFF"], logo: "img/escudos/atm.png" },
  { id: "juv", name: "Juventus",           tier: "bronce",  colors: ["#141414", "#FFFFFF"], logo: "img/escudos/juv.png" },
  { id: "bvb", name: "Borussia Dortmund",  tier: "bronce",  colors: ["#FDE100", "#141414"], logo: "img/escudos/bvb.png" },
  { id: "nap", name: "Napoli",             tier: "bronce",  colors: ["#12A0D7", "#FFFFFF"], logo: "img/escudos/nap.png" },
  { id: "cad", name: "Cádiz",              tier: "maldito", colors: ["#FFE500", "#0045A7"], logo: "img/escudos/cad.png" },
  { id: "lut", name: "Luton Town",         tier: "maldito", colors: ["#F78F1E", "#002D62"], logo: "img/escudos/lut.png" },
  { id: "sal", name: "Salernitana",        tier: "maldito", colors: ["#8A1E2C", "#FFFFFF"], logo: "img/escudos/sal.png" },
  { id: "ips", name: "Ipswich Town",       tier: "maldito", colors: ["#0044A9", "#FFFFFF"], logo: "img/escudos/ips.png" },
];
const TEAM_IDS = new Set(TEAMS.map((t) => t.id));

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
  const [guests, picks, queue, last] = await db.batch([
    db.prepare("SELECT num, name, photo FROM guests WHERE status = 'yes' ORDER BY num"),
    db.prepare("SELECT num, team, ord FROM picks ORDER BY ord"),
    db.prepare("SELECT num, pos FROM penalty_queue ORDER BY pos"),
    db.prepare("SELECT id, kind, num, zone, dive, result, team FROM penalty_log ORDER BY id DESC LIMIT 1"),
  ]);
  const person = (g) => ({ num: g.num, name: g.name, photo: g.photo ?? null });
  const confirmed = new Map(guests.results.map((g) => [g.num, g]));
  const players = picks.results
    .filter((p) => confirmed.has(p.num) && TEAM_IDS.has(p.team))
    .map((p) => ({ ...person(confirmed.get(p.num)), team: p.team, ord: p.ord }));
  const hasTeam = new Set(players.map((p) => p.num));
  const waiting = guests.results.filter((g) => !hasTeam.has(g.num));

  // La fila: los que ya estaban, en su orden, y al final los que confirmaron después de empezar.
  const started = queue.results.length > 0 || players.length > 0;
  const inQueue = new Set(queue.results.map((q) => q.num));
  const line = queue.results.filter((q) => confirmed.has(q.num) && !hasTeam.has(q.num)).map((q) => q.num);
  if (started) waiting.forEach((g) => { if (!inQueue.has(g.num)) line.push(g.num); });

  // Después de un gol, el que lo hizo tiene que elegir equipo antes de que patee el siguiente.
  const ev = last.results[0] || null;
  const scorer = ev && ev.kind === "shot" && ev.result === "gol" && line.includes(ev.num) ? ev.num : null;
  const phase = !started ? "idle" : scorer != null ? "pick" : line.length ? "shoot" : "done";
  return {
    tiers: TIERS, teams: TEAMS, players,
    queue: line.map((num) => person(confirmed.get(num))),
    waiting: started ? [] : waiting.map(person),
    phase, current: scorer ?? line[0] ?? null, last: ev,
  };
}

function logEvent(db, kind, f = {}) {
  return db
    .prepare("INSERT INTO penalty_log (kind, num, zone, dive, result, team, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
    .bind(kind, f.num ?? null, f.zone ?? null, f.dive ?? null, f.result ?? null, f.team ?? null, new Date().toISOString());
}

/** Guarda la fila tal como la muestra drawState (con los que se sumaron tarde al final). */
function saveQueue(db, state) {
  return [
    db.prepare("DELETE FROM penalty_queue"),
    ...state.queue.map((p, i) => db.prepare("INSERT INTO penalty_queue (num, pos) VALUES (?1, ?2)").bind(p.num, i + 1)),
  ];
}

async function drawStart(db) {
  const state = await drawState(db);
  if (state.phase !== "idle") return { error: "already_started" };
  if (!state.waiting.length) return { error: "nobody_waiting" };
  const line = state.waiting.slice();
  for (let i = line.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [line[i], line[j]] = [line[j], line[i]];
  }
  await db.batch([...saveQueue(db, { queue: line }), logEvent(db, "start")]);
  return { ok: true };
}

async function drawShoot(db, body) {
  const state = await drawState(db);
  if (state.phase !== "shoot") return { error: state.phase === "pick" ? "must_pick" : "not_shooting" };
  if (Number(body?.expect) !== state.current) return { error: "not_your_turn" };
  const zone = String(body?.zone || "");
  if (!ZONES.includes(zone)) return { error: "invalid_zone" };

  const { dive, result } = shoot(zone, randomIndex);
  const stmts = saveQueue(db, state);
  // Si no fue gol, pasa al final de la fila.
  if (result !== "gol") stmts.push(db.prepare("UPDATE penalty_queue SET pos = ?1 WHERE num = ?2").bind(state.queue.length + 1, state.current));
  stmts.push(logEvent(db, "shot", { num: state.current, zone, dive, result }));
  await db.batch(stmts);
  return { ok: true };
}

async function drawPick(db, body) {
  const state = await drawState(db);
  if (state.phase !== "pick") return { error: "not_picking" };
  if (Number(body?.expect) !== state.current) return { error: "not_your_turn" };
  const team = String(body?.team || "");
  if (!TEAM_IDS.has(team)) return { error: "invalid_team" };
  if (state.players.some((p) => p.team === team)) return { error: "team_taken" };

  const ord = state.players.reduce((m, p) => Math.max(m, p.ord), 0) + 1;
  await db.batch([
    ...saveQueue(db, state),
    db.prepare("DELETE FROM penalty_queue WHERE num = ?1").bind(state.current),
    db.prepare("DELETE FROM picks WHERE num = ?1").bind(state.current),
    db.prepare("INSERT INTO picks (num, team, ord, updated_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(state.current, team, ord, new Date().toISOString()),
    logEvent(db, "pick", { num: state.current, team }),
  ]);
  return { ok: true };
}

/** El organizador puede patear y elegir por cualquiera; un jugador, solo cuando le toca a él. */
async function canPlay(request, env, db, num) {
  if (sameToken(request.headers.get("x-admin-token") || "", env.ADMIN_TOKEN || "")) return true;
  const g = await findByCode(db, request.headers.get("x-guest-code"));
  return !!g && g.status === "yes" && g.num === num;
}

/* ---------- Torneo ---------- */

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
  if (groups.length) return { error: "groups_already_built" };
  const players = people.filter((p) => teamById.has(p.team)).map((p) => ({ num: p.num, tier: teamById.get(p.team).tier }));
  const built = buildGroups(players, randomIndex);
  if (!built) return { error: "invalid_player_count" };
  const fixture = groupMatches(built, formatFor(players.length));
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
        .bind(stages[0], slot, ord, 1, home, away, now));
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
          .bind(stages[s], slot, ord, 1, home, away, now));
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
  // En la llave, y en los cruces directos (13 a 16 jugadores), un empate se define por penales.
  let decisive = m.stage !== "group";
  if (!decisive) {
    const total = await db.prepare("SELECT COUNT(*) AS n FROM tgroups").first();
    decisive = !!formatFor(total?.n || 0)?.direct;
  }
  let pen = null;
  if (!clear && decisive && body.hg === body.ag) {
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

    if (method === "POST" && path === "/admin/check") {
      return sameToken(request.headers.get("x-admin-token") || "", env.ADMIN_TOKEN || "")
        ? json(200, { ok: true })
        : json(401, { error: "unauthorized" });
    }

    if (method === "GET" && path === "/draw") {
      return json(200, await drawState(db));
    }

    if (method === "POST" && (path.startsWith("/draw/") || path === "/admin/draw/reset")) {
      const isAdmin = sameToken(request.headers.get("x-admin-token") || "", env.ADMIN_TOKEN || "");
      // Con el torneo armado, el sorteo queda cerrado: los grupos dependen de los equipos.
      if (await db.prepare("SELECT 1 FROM tgroups LIMIT 1").first()) return json(409, { error: "tournament_started" });
      let result;
      if (path === "/draw/start" || path === "/admin/draw/reset") {
        if (!isAdmin) return json(401, { error: "unauthorized" });
        if (path === "/draw/start") result = await drawStart(db);
        else {
          await db.batch([db.prepare("DELETE FROM picks"), db.prepare("DELETE FROM penalty_queue"), logEvent(db, "reset")]);
          result = { ok: true };
        }
      } else if (path === "/draw/shoot" || path === "/draw/pick") {
        const body = await readJson(request);
        if (!(await canPlay(request, env, db, Number(body?.expect)))) return json(401, { error: "unauthorized" });
        result = path === "/draw/shoot" ? await drawShoot(db, body) : await drawPick(db, body);
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
