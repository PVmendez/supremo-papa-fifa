// API del torneo, como Cloudflare Pages Function sobre D1.
//
//   GET  /api/rsvps          -> estado público: nombre y foto solo de quienes ya respondieron
//   GET  /api/me?c=CODE      -> datos del invitado dueño del código
//   POST /api/rsvp           -> { code, status: "yes" | "no" }
//   POST /api/admin/reset    -> { num }  (header x-admin-token) vuelve a "pending"
//   POST /api/admin/check    -> 200 si el código del organizador (header x-admin-token) es correcto
//
// Sorteo de equipos por penales (ver lib/penalty.js):
//   GET  /api/draw                    -> equipos, quién tiene cada uno, la fila, las casillas del fixture y el último movimiento
//   POST /api/draw/start              -> (organizador) arma la fila al azar y una casilla vacía por confirmado
//   POST /api/draw/shoot              -> { zone, expect } patea el que está primero en la fila
//   POST /api/draw/pick               -> { team, expect } el que hizo el gol elige equipo
//   POST /api/admin/draw/place        -> { slot, expect } cuando todos tienen equipo, el organizador ubica a cada uno
//                                        en su casilla, en el mismo orden en que eligieron equipo
//   POST /api/admin/draw/absent       -> { num } el que no vino sale de la fila
//   POST /api/admin/draw/remove-slot  -> { slot } saca una casilla vacía que sobra
//   POST /api/admin/draw/reset        -> borra el sorteo
// shoot y pick los puede hacer el organizador (x-admin-token) o el propio jugador con su código (x-guest-code).
// expect es el número del jugador que la pantalla cree que está pateando, para no patear por otro.
//
// Torneo (liga por casillas + playoff + llave, ver lib/tournament.js):
//   GET  /api/tournament               -> tabla, partidos, llave y campeón
//   POST /api/admin/tournament/start   -> arma la liga con las casillas del sorteo
//   POST /api/admin/tournament/result  -> { id, hg, ag, pen_winner? } carga (o borra, con null) un resultado
//   POST /api/admin/tournament/reset   -> borra el torneo
//
// Bindings: DB (D1) y la variable secreta ADMIN_TOKEN.

import { shoot, ZONES } from "../../lib/penalty.js";
import {
  MIN_PLAYERS, formatFor, leagueMatches, standings, zoneOf, resolveKnockout, winnerOf, isPlayed,
} from "../../lib/tournament.js";

const VALID = new Set(["yes", "no"]);

// Los 16 mejores equipos de clubes de FC 27 según EA (8 de 5 estrellas y 8 de 4 y media).
// El escudo de cada uno está en web/img/escudos/<id>.png. Para cambiar un equipo basta con editar esta lista.
const TEAMS = [
  { id: "rma", name: "Real Madrid",        colors: ["#FFFFFF", "#FEBE10"], logo: "img/escudos/rma.png" },
  { id: "mci", name: "Manchester City",    colors: ["#6CABDD", "#1C2C5B"], logo: "img/escudos/mci.png" },
  { id: "psg", name: "PSG",                colors: ["#004170", "#DA291C"], logo: "img/escudos/psg.png" },
  { id: "bay", name: "Bayern Múnich",      colors: ["#DC052D", "#FFFFFF"], logo: "img/escudos/bay.png" },
  { id: "bar", name: "Barcelona",          colors: ["#A50044", "#004D98"], logo: "img/escudos/bar.png" },
  { id: "ars", name: "Arsenal",            colors: ["#EF0107", "#FFFFFF"], logo: "img/escudos/ars.png" },
  { id: "liv", name: "Liverpool",          colors: ["#C8102E", "#F6EB61"], logo: "img/escudos/liv.png" },
  { id: "atm", name: "Atlético de Madrid", colors: ["#CB3524", "#FFFFFF"], logo: "img/escudos/atm.png" },
  { id: "juv", name: "Juventus",           colors: ["#141414", "#FFFFFF"], logo: "img/escudos/juv.png" },
  { id: "mun", name: "Manchester United",  colors: ["#DA291C", "#FBE122"], logo: "img/escudos/mun.png" },
  { id: "che", name: "Chelsea",            colors: ["#034694", "#FFFFFF"], logo: "img/escudos/che.png" },
  { id: "nap", name: "Napoli",             colors: ["#12A0D7", "#FFFFFF"], logo: "img/escudos/nap.png" },
  { id: "bvb", name: "Borussia Dortmund",  colors: ["#FDE100", "#141414"], logo: "img/escudos/bvb.png" },
  { id: "rom", name: "Roma",               colors: ["#8E1F2F", "#F0BC42"], logo: "img/escudos/rom.png" },
  { id: "tot", name: "Tottenham",          colors: ["#FFFFFF", "#132257"], logo: "img/escudos/tot.png" },
  { id: "avl", name: "Aston Villa",        colors: ["#670E36", "#95BFE5"], logo: "img/escudos/avl.png" },
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
  const [guests, picks, queue, slots, last] = await db.batch([
    db.prepare("SELECT num, name, photo FROM guests WHERE status = 'yes' ORDER BY num"),
    db.prepare("SELECT num, team, ord FROM picks ORDER BY ord"),
    db.prepare("SELECT num, pos FROM penalty_queue ORDER BY pos"),
    db.prepare("SELECT slot, num FROM slots ORDER BY slot"),
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

  // Las casillas del fixture: una por confirmado. Si llega alguien tarde se agrega una al final de la ronda.
  // Una casilla cuyo dueño ya no está confirmado queda libre.
  const ring = slots.results.map((r) => ({ slot: r.slot, num: hasTeam.has(r.num) ? r.num : null }));
  if (started) {
    let next = ring.reduce((m, r) => Math.max(m, r.slot), 0);
    while (ring.length < confirmed.size) ring.push({ slot: ++next, num: null, pending: true });
  }

  // Después de un gol, el que lo hizo tiene que elegir equipo antes de que patee el siguiente.
  // Cuando ya no queda nadie en la fila, cada uno elige casilla en el orden en que eligió equipo.
  const ev = last.results[0] || null;
  const scorer = ev && ev.kind === "shot" && ev.result === "gol" && line.includes(ev.num) ? ev.num : null;
  const placed = new Set(ring.filter((r) => r.num != null).map((r) => r.num));
  const toPlace = players.filter((p) => !placed.has(p.num)).map((p) => p.num);
  const phase = !started ? "idle" : scorer != null ? "pick" : line.length ? "shoot" : toPlace.length ? "place" : "done";
  const current = scorer ?? (phase === "shoot" ? line[0] : phase === "place" ? toPlace[0] : null);
  return {
    teams: TEAMS, players,
    queue: line.map((num) => person(confirmed.get(num))),
    waiting: started ? [] : waiting.map(person),
    slots: ring, toPlace,
    phase, current: current ?? null, last: ev,
  };
}

function logEvent(db, kind, f = {}) {
  return db
    .prepare("INSERT INTO penalty_log (kind, num, zone, dive, result, team, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
    .bind(kind, f.num ?? null, f.zone ?? null, f.dive ?? null, f.result ?? null, f.team ?? null, new Date().toISOString());
}

/** Guarda la fila y las casillas tal como las muestra drawState (con los que se sumaron tarde). */
function saveDraw(db, state) {
  return [
    db.prepare("DELETE FROM penalty_queue"),
    ...state.queue.map((p, i) => db.prepare("INSERT INTO penalty_queue (num, pos) VALUES (?1, ?2)").bind(p.num, i + 1)),
    ...state.slots.filter((r) => r.pending).map((r) => db.prepare("INSERT INTO slots (slot, num) VALUES (?1, NULL)").bind(r.slot)),
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
  await db.batch([
    ...saveDraw(db, { queue: line, slots: [] }),
    db.prepare("DELETE FROM slots"),
    ...line.map((_, i) => db.prepare("INSERT INTO slots (slot, num) VALUES (?1, NULL)").bind(i + 1)),
    logEvent(db, "start"),
  ]);
  return { ok: true };
}

async function drawShoot(db, body) {
  const state = await drawState(db);
  if (state.phase !== "shoot") return { error: state.phase === "pick" ? "must_pick" : "not_shooting" };
  if (Number(body?.expect) !== state.current) return { error: "not_your_turn" };
  const zone = String(body?.zone || "");
  if (!ZONES.includes(zone)) return { error: "invalid_zone" };

  const { dive, result } = shoot(zone, randomIndex);
  const stmts = saveDraw(db, state);
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
    ...saveDraw(db, state),
    db.prepare("DELETE FROM penalty_queue WHERE num = ?1").bind(state.current),
    db.prepare("DELETE FROM picks WHERE num = ?1").bind(state.current),
    db.prepare("INSERT INTO picks (num, team, ord, updated_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(state.current, team, ord, new Date().toISOString()),
    db.prepare("UPDATE slots SET num = NULL WHERE num = ?1").bind(state.current),
    logEvent(db, "pick", { num: state.current, team }),
  ]);
  return { ok: true };
}

/** Segunda parte del sorteo: el organizador ubica en una casilla libre al que le toca. */
async function drawPlace(db, body) {
  const state = await drawState(db);
  if (state.phase !== "place") return { error: "not_placing" };
  if (Number(body?.expect) !== state.current) return { error: "not_your_turn" };
  const slot = state.slots.find((r) => r.slot === Number(body?.slot));
  if (!slot) return { error: "invalid_slot" };
  if (slot.num != null) return { error: "slot_taken" };
  await db.batch([
    ...saveDraw(db, state),
    db.prepare("UPDATE slots SET num = ?1 WHERE slot = ?2").bind(state.current, slot.slot),
  ]);
  return { ok: true };
}

/** El que no vino: queda como que no asiste y sale de la fila. Su casilla se saca aparte. */
async function drawAbsent(db, body) {
  const state = await drawState(db);
  const num = Number(body?.num);
  if (!state.queue.some((p) => p.num === num)) return { error: "not_in_line" };
  if (state.phase === "pick" && state.current === num) return { error: "must_pick" };
  await db.batch([
    ...saveDraw(db, state),
    db.prepare("DELETE FROM penalty_queue WHERE num = ?1").bind(num),
    db.prepare("UPDATE guests SET status = 'no', updated_at = ?1 WHERE num = ?2").bind(new Date().toISOString(), num),
  ]);
  return { ok: true };
}

/** Saca una casilla vacía, solo si sobra (hay más casillas que confirmados). Las vecinas pasan a enfrentarse. */
async function drawRemoveSlot(db, body) {
  const state = await drawState(db);
  const slot = state.slots.find((r) => r.slot === Number(body?.slot));
  if (!slot || slot.pending) return { error: "invalid_slot" };
  if (slot.num != null) return { error: "slot_taken" };
  const confirmed = state.players.length + state.queue.length;
  if (state.slots.length - 1 < confirmed) return { error: "slot_needed" };
  await db.batch([...saveDraw(db, state), db.prepare("DELETE FROM slots WHERE slot = ?1").bind(slot.slot)]);
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
  const [people, slotRows, matchRows] = await db.batch([
    db.prepare("SELECT g.num, g.name, g.photo, p.team FROM guests g JOIN picks p ON p.num = g.num WHERE g.status = 'yes'"),
    db.prepare("SELECT slot, num FROM slots ORDER BY slot"),
    db.prepare("SELECT id, stage, slot, ord, home, away, hg, ag, pen_winner FROM matches ORDER BY ord, id"),
  ]);
  const byNum = new Map(people.results.filter((p) => teamById.has(p.team))
    .map((p) => [p.num, { num: p.num, name: p.name, photo: p.photo ?? null, team: teamById.get(p.team) }]));
  // La ronda en el orden de las casillas; las vacías o de alguien que ya no juega no cuentan.
  const ring = slotRows.results.filter((r) => byNum.has(r.num)).map((r) => r.num);
  const emptySlots = slotRows.results.length - ring.length;
  const unplaced = byNum.size - ring.length;
  return { byNum, ring, emptySlots, unplaced, matches: matchRows.results };
}

async function tournamentState(db) {
  const { byNum, ring, emptySlots, matches } = await tournamentData(db);
  const players = [...byNum.values()];
  if (!matches.length) {
    return { status: "none", eligible: ring.length, emptySlots, format: formatFor(ring.length), minPlayers: MIN_PLAYERS, players, ring };
  }
  const league = matches.filter((m) => m.stage === "league");
  const leagueNums = [...new Set(league.flatMap((m) => [m.home, m.away]))];
  const fmt = formatFor(leagueNums.length);
  const table = standings(leagueNums, league).map((r, i) => ({ ...r, zone: zoneOf(fmt, i + 1) }));
  const ko = matches.filter((m) => m.stage !== "league");
  const final = ko.find((m) => m.stage === "final");
  const champion = final ? winnerOf(final) : null;
  return {
    status: champion ? "done" : ko.length ? "knockout" : "league",
    format: fmt, players, ring, table, matches, champion,
  };
}

async function startTournament(db) {
  const { ring, emptySlots, unplaced, matches } = await tournamentData(db);
  if (matches.length) return { error: "groups_already_built" };
  if (unplaced || (await db.prepare("SELECT 1 FROM penalty_queue LIMIT 1").first())) return { error: "draw_not_finished" };
  if (emptySlots) return { error: "empty_slots" };
  const fmt = formatFor(ring.length);
  if (!fmt) return { error: "invalid_player_count" };
  const now = new Date().toISOString();
  await db.batch(leagueMatches(ring, fmt.kind).map((m) => db
    .prepare("INSERT INTO matches (stage, slot, ord, console, home, away, updated_at) VALUES ('league', 0, ?1, 1, ?2, ?3, ?4)")
    .bind(m.ord, m.home, m.away, now)));
  return { ok: true };
}

/**
 * Cuando termina la liga se arma el playoff y la llave, y cada cruce se completa a medida que hay
 * ganadores. Si se corrige un resultado, los cruces que dependían de él se rehacen y se borran.
 */
async function advanceKnockout(db) {
  for (let pass = 0; pass < 6; pass++) {
    const { matches } = await tournamentData(db);
    const league = matches.filter((m) => m.stage === "league");
    if (!league.length || !league.every(isPlayed)) return;
    const nums = [...new Set(league.flatMap((m) => [m.home, m.away]))];
    const fmt = formatFor(nums.length);
    const table = standings(nums, league);
    const find = (stage, slot) => matches.find((m) => m.stage === stage && m.slot === slot) || null;
    let ord = matches.reduce((m, x) => Math.max(m, x.ord), 0);
    const now = new Date().toISOString();
    const stmts = [];
    for (const want of resolveKnockout(fmt, table, find)) {
      const cur = find(want.stage, want.slot);
      if (!cur) {
        stmts.push(db
          .prepare("INSERT INTO matches (stage, slot, ord, console, home, away, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6)")
          .bind(want.stage, want.slot, ++ord, want.home, want.away, now));
      } else if (cur.home !== want.home || cur.away !== want.away) {
        stmts.push(db
          .prepare("UPDATE matches SET home = ?1, away = ?2, hg = NULL, ag = NULL, pen_winner = NULL, updated_at = ?3 WHERE id = ?4")
          .bind(want.home, want.away, now, cur.id));
      }
    }
    if (!stmts.length) return;
    await db.batch(stmts);
  }
}

async function saveResult(db, body) {
  const id = Number(body?.id);
  if (!Number.isInteger(id)) return { error: "invalid_id" };
  const m = await db.prepare("SELECT id, stage, home, away FROM matches WHERE id = ?1").bind(id).first();
  if (!m) return { error: "not_found" };
  if (m.home == null || m.away == null) return { error: "match_not_ready" };
  if (m.stage === "league" && (await db.prepare("SELECT 1 FROM matches WHERE stage != 'league' LIMIT 1").first())) {
    return { error: "knockout_started" };
  }

  const clear = body.hg == null && body.ag == null;
  const goal = (v) => Number.isInteger(v) && v >= 0 && v <= 99;
  if (!clear && (!goal(body.hg) || !goal(body.ag))) return { error: "invalid_score" };
  // En el playoff y la llave, un empate se define por penales.
  let pen = null;
  if (!clear && m.stage !== "league" && body.hg === body.ag) {
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

    if (method === "POST" && (path.startsWith("/draw/") || path.startsWith("/admin/draw/"))) {
      const isAdmin = sameToken(request.headers.get("x-admin-token") || "", env.ADMIN_TOKEN || "");
      // Con el torneo armado, el sorteo queda cerrado: la liga sale de las casillas.
      if (await db.prepare("SELECT 1 FROM matches LIMIT 1").first()) return json(409, { error: "tournament_started" });
      const body = await readJson(request);
      let result;
      if (path === "/draw/shoot" || path === "/draw/pick") {
        if (!(await canPlay(request, env, db, Number(body?.expect)))) return json(401, { error: "unauthorized" });
        result = path === "/draw/shoot" ? await drawShoot(db, body) : await drawPick(db, body);
      } else {
        if (!isAdmin) return json(401, { error: "unauthorized" });
        if (path === "/draw/start") result = await drawStart(db);
        else if (path === "/admin/draw/place") result = await drawPlace(db, body);
        else if (path === "/admin/draw/absent") result = await drawAbsent(db, body);
        else if (path === "/admin/draw/remove-slot") result = await drawRemoveSlot(db, body);
        else if (path === "/admin/draw/reset") {
          await db.batch([
            db.prepare("DELETE FROM picks"), db.prepare("DELETE FROM penalty_queue"), db.prepare("DELETE FROM slots"),
            logEvent(db, "reset"),
          ]);
          result = { ok: true };
        } else return json(404, { error: "not_found" });
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
        await db.prepare("DELETE FROM matches").run();
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
