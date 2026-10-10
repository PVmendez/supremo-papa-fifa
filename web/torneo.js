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

  /** El formato en una frase, con la cuenta de partidos para una sola consola. */
  function describe(fmt, n) {
    if (!fmt) return "Hacen falta al menos 4 jugadores con equipo para armar el torneo.";
    var text;
    if (fmt.kind === "rr") {
      text = "todos contra todos y final entre el 1º y el 2º";
    } else {
      var ko = fmt.direct === 6 ? "cuartos" : "semis";
      var po = fmt.playoff.map(function (p) { return p[0] + "º vs " + p[1] + "º"; }).join(" y ");
      text = "liga de 2 partidos cada uno (contra las casillas de al lado); del 1º al " + fmt.direct + "º a " + ko +
        ", playoff " + po + " por los dos lugares que faltan";
    }
    return (n ? n + " jugadores: " : "") + text + ". En playoff y llave, si empatan, penales. " +
      fmt.matches + " partidos en una consola, unas " + duration(fmt.minutes) + " con tiempos de 3 minutos.";
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
    state.matches.filter(function (m) { return m.stage === "league"; }).forEach(function (m) { games.appendChild(matchEl(m)); });
    fixture.appendChild(games);

    $("groups").replaceChildren(card, fixture);
    $("groups-block").hidden = false;
  }

  function renderNext() {
    var pending = state.matches.filter(function (m) { return m.hg == null && m.home != null && m.away != null; });
    var block = $("next-block");
    if (!pending.length) { block.hidden = true; return; }
    // Una sola consola: el que se juega ahora y los dos que siguen, para que vayan agarrando el joystick.
    var playedCount = state.matches.filter(function (m) { return m.hg != null; }).length;
    var total = state.format ? state.format.matches : state.matches.length;
    var frag = document.createDocumentFragment();
    pending.slice(0, 3).forEach(function (m, i) {
      var wrap = el("div", "next-match" + (i === 0 ? " now" : ""));
      var label = (i === 0 ? "Ahora" : i === 1 ? "Después" : "Se preparan") + " · " + STAGE_LABEL[m.stage] +
        " · Partido " + (playedCount + i + 1) + " de " + total;
      wrap.appendChild(el("span", "next-label", label));
      wrap.appendChild(matchEl(m));
      frag.appendChild(wrap);
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
        : "El torneo se arma después del sorteo de equipos.";
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
      if (window.confirm("¿Armar la liga con las casillas del sorteo? Después el sorteo queda cerrado.")) adminRun($("btn-start"), "/admin/tournament/start");
    });
    $("btn-reset").addEventListener("click", function () {
      if (window.confirm("¿Borrar la liga, los partidos y los resultados?")) adminRun($("btn-reset"), "/admin/tournament/reset");
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
