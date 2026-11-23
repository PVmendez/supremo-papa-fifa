// El torneo: liga por casillas, playoff, llave y campeón. El organizador carga los resultados acá.
(function () {
  "use strict";

  var S = window.Supremo, FX = window.Effects;
  var el = S.el;

  var STAGE_LABEL = { league: "Liga", po: "Playoff", qf: "Cuartos", sf: "Semifinales", final: "Final" };
  var ZONE_LABEL = { direct: "A la llave", po: "Playoff", out: "Afuera" };
  var state = null;
  var championShown = null;

  var $ = function (id) { return document.getElementById(id); };

  function player(num) {
    return (state.players || []).find(function (p) { return p.num === num; }) || null;
  }

  function duration(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + " h" + (m ? " " + m : "") : m + " min";
  }

  /** El formato en una frase, con la cuenta de turnos para las dos salas. */
  function describe(fmt, n) {
    if (!fmt) return "Hacen falta al menos 4 jugadores con equipo para armar el torneo.";
    var text;
    if (fmt.kind === "rr") {
      text = "todos contra todos y final entre el 1º y el 2º";
    } else {
      var ko = fmt.direct === 6 ? "cuartos" : "semis";
      var po = fmt.playoff.map(function (p) { return p[0] + "º vs " + p[1] + "º"; }).join(" y ");
      var rivals = n && n % 2 === 1 ? "las dos de al lado y las dos que están a media vuelta" : "las dos de al lado y la de enfrente";
      text = "liga de " + fmt.games + " partidos cada uno (contra " + rivals + "); del 1º al " + fmt.direct + "º a " + ko +
        ", playoff " + po + " por los dos lugares que faltan";
    }
    return (n ? n + " jugadores: " : "") + text + ". En playoff y llave, si empatan, penales. " +
      fmt.matches + " partidos en dos consolas a la vez (Sala 1 y Sala 2): " + fmt.turns + " turnos, unas " +
      duration(fmt.minutes) + " con tiempos de 3 minutos.";
  }

  /* ---------- Piezas ---------- */

  function side(num, cls) {
    var p = num != null ? player(num) : null;
    var s = el("span", "side " + cls);
    if (!p) { s.appendChild(el("span", "muted", "Por definir")); return s; }
    s.appendChild(S.avatar(p, "avatar-xs"));
    var name = el("span", "side-name");
    name.appendChild(el("b", null, p.name));
    if (p.team) name.appendChild(el("small", null, p.team.name));
    s.appendChild(name);
    return s;
  }

  function matchEl(m) {
    var played = m.hg != null && m.ag != null;
    var box = el(isAdmin() ? "button" : "div", "match" + (played ? " played" : ""));
    if (isAdmin()) { box.type = "button"; box.addEventListener("click", function () { openScore(m); }); }
    if (played) {
      var hw = m.hg > m.ag || m.pen_winner === m.home, aw = m.ag > m.hg || m.pen_winner === m.away;
      if (hw) box.classList.add("home-won");
      if (aw) box.classList.add("away-won");
    }
    if (m.room) box.appendChild(el("span", "room-tag room-" + m.room, "Sala " + m.room));
    box.appendChild(side(m.home, "home"));
    var score = el("span", "score", played ? m.hg + " – " + m.ag : "vs");
    if (played && m.pen_winner) score.appendChild(el("small", null, "pen."));
    box.appendChild(score);
    box.appendChild(side(m.away, "away"));
    return box;
  }

  /* ---------- Secciones ---------- */

  function renderLeague() {
    var card = el("div", "group league");
    var table = el("table", "standings");
    var head = el("tr");
    ["", "Jugador", "PJ", "DG", "Pts"].forEach(function (h) { head.appendChild(el("th", null, h)); });
    var thead = el("thead"); thead.appendChild(head); table.appendChild(thead);
    var tbody = el("tbody");
    state.table.forEach(function (r, i) {
      var p = player(r.num);
      var tr = el("tr", "zone-" + r.zone);
      tr.title = ZONE_LABEL[r.zone];
      tr.appendChild(el("td", "pos", String(i + 1)));
      var who = el("td", "who");
      if (p) { who.appendChild(S.avatar(p, "avatar-xs")); who.appendChild(el("span", null, p.name)); if (p.team) who.appendChild(S.crest(p.team, "sm")); }
      tr.appendChild(who);
      tr.appendChild(el("td", null, String(r.pj)));
      tr.appendChild(el("td", null, (r.dg > 0 ? "+" : "") + r.dg));
      tr.appendChild(el("td", "pts", String(r.pts)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    card.appendChild(table);
    var legend = el("p", "zones-legend");
    ["direct", "po", "out"].forEach(function (z) {
      if (z === "po" && !state.format.playoff.length) return;
      var item = el("span", "zone-key zone-" + z);
      item.appendChild(el("i"));
      item.appendChild(document.createTextNode(z === "direct" ? (state.format.kind === "rr" ? "A la final" : "Directo a " + (state.format.direct === 6 ? "cuartos" : "semis")) : ZONE_LABEL[z]));
      legend.appendChild(item);
    });
    card.appendChild(legend);

    var fixture = el("div", "group");
    fixture.appendChild(el("h3", null, "Partidos de la liga"));
    var games = el("div", "group-games");
    var lastTurn = null;
    state.matches.filter(function (m) { return m.stage === "league"; }).forEach(function (m) {
      if (m.ord !== lastTurn) { games.appendChild(el("h4", "turn-label", "Turno " + m.ord)); lastTurn = m.ord; }
      games.appendChild(matchEl(m));
    });
    fixture.appendChild(games);

    var parts = [card, fixture];
    if (state.format.kind === "ring" && state.ring && state.ring.length > 2) parts.unshift(leagueMap());
    $("groups").replaceChildren.apply($("groups"), parts);
    $("groups-block").hidden = false;
  }

  /** La liga en tarjetas: cada casilla con contra quién juega y el resultado de cada partido. */
  function leagueMap() {
    var ring = state.ring, n = ring.length;
    var league = state.matches.filter(function (m) { return m.stage === "league"; });
    var nodes = ring.map(function (num, i) {
      var p = player(num);
      return { label: String(i + 1), person: p, team: p && p.team, free: !p };
    });
    var box = el("div", "group league-map");
    box.appendChild(el("h3", null, "Contra quién juega cada uno"));
    box.appendChild(el("p", "muted rivals-note", n % 2 === 0
      ? "Cada casilla juega contra las dos de al lado y la de enfrente."
      : "Cada casilla juega contra las dos de al lado y las dos que están a media vuelta."));
    box.appendChild(S.rivalsGrid({
      nodes: nodes,
      score: function (i, j) {
        var a = ring[i], b = ring[j];
        var m = league.find(function (x) { return (x.home === a && x.away === b) || (x.home === b && x.away === a); });
        if (!m || m.hg == null) return null;
        var mine = m.home === a ? [m.hg, m.ag] : [m.ag, m.hg];
        return { text: mine[0] + " – " + mine[1], cls: mine[0] > mine[1] ? "win" : mine[0] < mine[1] ? "loss" : "draw" };
      },
    }));
    return box;
  }

  function renderNext() {
    var pending = state.matches.filter(function (m) { return m.hg == null && m.home != null && m.away != null; });
    var block = $("next-block");
    if (!pending.length) { block.hidden = true; return; }
    // Dos consolas: en cada sala, el partido que se juega ahora y el que sigue.
    // Si alguien del partido de una sala todavía está jugando en la otra, se avisa que espere.
    var frag = document.createDocumentFragment();
    var rooms = [1, 2];
    var nowBy = {};
    rooms.forEach(function (r) { nowBy[r] = pending.filter(function (m) { return (m.room || 1) === r; })[0] || null; });
    rooms.forEach(function (r) {
      var mine = pending.filter(function (m) { return (m.room || 1) === r; });
      var col = el("div", "next-room");
      col.appendChild(el("h3", "next-room-title room-" + r, "Sala " + r));
      if (!mine.length) { col.appendChild(el("p", "muted", "Sin partidos por ahora.")); frag.appendChild(col); return; }
      mine.slice(0, 2).forEach(function (m, i) {
        var other = nowBy[r === 1 ? 2 : 1];
        var waits = i === 0 && other && other.ord < m.ord &&
          [m.home, m.away].some(function (p) { return p === other.home || p === other.away; });
        var wrap = el("div", "next-match" + (i === 0 ? " now" : ""));
        var label = (i === 0 ? (waits ? "Espera a la Sala " + (r === 1 ? 2 : 1) : "Ahora") : "Después") +
          " · " + STAGE_LABEL[m.stage] + " · Turno " + m.ord;
        wrap.appendChild(el("span", "next-label", label));
        wrap.appendChild(matchEl(m));
        col.appendChild(wrap);
      });
      frag.appendChild(col);
    });
    $("next").replaceChildren(frag);
    block.hidden = false;
  }

  function renderBracket() {
    var ko = state.matches.filter(function (m) { return m.stage !== "league"; });
    if (!ko.length) { $("bracket-block").hidden = true; return; }
    var frag = document.createDocumentFragment();
    ["po", "qf", "sf", "final"].forEach(function (stage) {
      var games = ko.filter(function (m) { return m.stage === stage; }).sort(function (a, b) { return a.slot - b.slot; });
      if (!games.length) return;
      var col = el("div", "round round-" + stage);
      col.appendChild(el("h3", null, STAGE_LABEL[stage]));
      games.forEach(function (m) { col.appendChild(matchEl(m)); });
      frag.appendChild(col);
    });
    $("bracket").replaceChildren(frag);
    $("bracket-block").hidden = false;
  }

  function renderChampion(celebrate) {
    var box = $("champion");
    var p = state.champion != null ? player(state.champion) : null;
    if (!p) { box.hidden = true; championShown = null; return; }
    if (championShown === p.num) return;
    var inner = el("div", "champion-inner");
    var photo = el("div", "stage-photo champion-photo");
    if (p.photo) { var img = document.createElement("img"); img.src = p.photo; img.alt = ""; photo.appendChild(img); }
    inner.appendChild(photo);
    var txt = el("div", "champion-text");
    txt.appendChild(el("small", null, "👑 Campeón"));
    txt.appendChild(el("strong", null, p.name));
    txt.appendChild(el("span", null, "El Supremo Papá del FIFA 2026" + (p.team ? " · " + p.team.name : "")));
    inner.appendChild(txt);
    box.replaceChildren(inner);
    box.hidden = false;
    championShown = p.num;
    if (FX && celebrate) {
      FX.popConfetti(photo, { particles: 70, streamers: 16 });
      setTimeout(function () { FX.popConfetti(photo, { direction: "up", particles: 40, streamers: 10 }); }, 600);
    }
  }

  function render(next) {
    var celebrate = state !== null;   // en la primera carga no hay festejo, solo si el campeón aparece en vivo
    state = next;
    var n = state.table ? state.table.length : state.eligible;
    $("format").textContent = describe(state.format, n);
    var started = state.status !== "none";
    $("empty").textContent = started ? "" :
      state.emptySlots ? "Hay casillas vacías en el fixture: sacalas en el sorteo antes de armar la liga." :
      state.eligible >= state.minPlayers
        ? "Ya hay " + state.eligible + " jugadores con equipo y casilla. Falta que el organizador arme la liga."
        : "El torneo se arma después del sorteo de equipos y de salas.";
    $("btn-start").hidden = started;
    if (!started) {
      ["groups-block", "next-block", "bracket-block"].forEach(function (id) { $(id).hidden = true; });
      $("champion").hidden = true;
      return;
    }
    renderChampion(celebrate);
    renderNext();
    renderBracket();
    renderLeague();
  }

  function load() {
    return S.api("/tournament").then(render).catch(function () { /* reintenta en el próximo ciclo */ });
  }

  /* ---------- Admin ---------- */

  var adminOn = false, gate = null;
  function isAdmin() { return adminOn; }
  var msg = $("admin-msg");

  function adminRun(btn, path, body) {
    btn.disabled = true;
    msg.textContent = "";
    return S.adminPost(path, body).then(render).catch(function (err) {
      msg.textContent = S.errorText(err);
      if (err.status === 401) gate.invalid();
    }).then(function () { btn.disabled = false; });
  }

  var dialog = $("score-dialog"), current = null;

  function openScore(m) {
    if (m.home == null || m.away == null) { msg.textContent = S.errorText({ code: "match_not_ready" }); return; }
    current = m;
    var h = player(m.home), a = player(m.away);
    $("score-title").textContent = STAGE_LABEL[m.stage];
    $("home-name").textContent = h ? h.name : "Local";
    $("away-name").textContent = a ? a.name : "Visitante";
    $("pen-home-name").textContent = h ? h.name : "";
    $("pen-away-name").textContent = a ? a.name : "";
    $("hg").value = m.hg != null ? m.hg : "";
    $("ag").value = m.ag != null ? m.ag : "";
    $("pen-home").checked = m.pen_winner === m.home;
    $("pen-away").checked = m.pen_winner === m.away;
    $("score-msg").textContent = "";
    syncPens();
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
    $("hg").focus();
  }

  function syncPens() {
    var tie = current && current.stage !== "league" && $("hg").value !== "" && $("hg").value === $("ag").value;
    $("pens").hidden = !tie;
  }

  function closeScore() { if (dialog.close) dialog.close(); else dialog.removeAttribute("open"); current = null; }

  function sendScore(body) {
    var save = $("score-save");
    save.disabled = true;
    S.adminPost("/admin/tournament/result", Object.assign({ id: current.id }, body)).then(function (next) {
      closeScore();
      render(next);
    }).catch(function (err) {
      $("score-msg").textContent = S.errorText(err);
      if (err.status === 401) { closeScore(); gate.invalid(); }
    }).then(function () { save.disabled = false; });
  }

  function initAdmin() {
    // Al entrar o salir se repinta todo: los partidos pasan a ser botones para cargar resultados (o dejan de serlo).
    gate = S.adminGate(function (on) { adminOn = on; if (state) render(state); });
    $("btn-start").addEventListener("click", function () {
      S.ask({ title: "¿Armamos la liga?", text: "Los partidos salen de las casillas del sorteo y a cada uno se le sortea la Sala 1 o la Sala 2. Después el sorteo queda cerrado.", ok: "Armar" })
        .then(function (yes) { if (yes) adminRun($("btn-start"), "/admin/tournament/start"); });
    });
    $("btn-reset").addEventListener("click", function () {
      S.ask({ title: "¿Borrar el torneo?", text: "Se borran la liga, los partidos y los resultados.", ok: "Borrar", danger: true })
        .then(function (yes) { if (yes) adminRun($("btn-reset"), "/admin/tournament/reset"); });
    });
    $("hg").addEventListener("input", syncPens);
    $("ag").addEventListener("input", syncPens);
    $("score-cancel").addEventListener("click", closeScore);
    $("score-clear").addEventListener("click", function () { sendScore({ hg: null, ag: null }); });
    $("score-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var hg = Number($("hg").value), ag = Number($("ag").value);
      var body = { hg: hg, ag: ag };
      if (!$("pens").hidden) {
        if ($("pen-home").checked) body.pen_winner = current.home;
        else if ($("pen-away").checked) body.pen_winner = current.away;
        else { $("score-msg").textContent = S.errorText({ code: "pen_winner_required" }); return; }
      }
      sendScore(body);
    });
  }

  initAdmin();
  load();
  setInterval(function () { if (!document.hidden && !(dialog.open)) load(); }, 10000);
})();
