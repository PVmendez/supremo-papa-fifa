// La noche de los sobres: muestra el sorteo en vivo y anima cada sobre o robo en todas las pantallas.
(function () {
  "use strict";

  var S = window.Supremo, FX = window.Effects, gsap = window.gsap;
  var el = S.el;
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var animate = !!gsap && !reduced;

  var stage = document.getElementById("stage");
  var overlay = document.getElementById("overlay");
  var overlayStage = document.getElementById("overlay-stage");
  var board = document.getElementById("board");
  var waiting = document.getElementById("waiting");

  var state = null;
  var shownEvent = null;   // id del último movimiento ya mostrado
  var busy = false;        // mientras corre una animación no se repinta el tablero (no spoilea)

  var TIER_LABEL = { oro: "Bombo Oro", plata: "Bombo Plata", bronce: "Bombo Bronce", maldito: "Bombo Maldito" };

  function teamOf(id) { return state.teams.find(function (t) { return t.id === id; }) || null; }
  function playerOf(num) {
    return state.players.find(function (p) { return p.num === num; }) ||
      state.waiting.find(function (p) { return p.num === num; }) || { num: num, name: "#" + num };
  }

  /* ---------- Tablero ---------- */

  var boardKey = "";

  function renderBoard() {
    // Solo se repinta si algo cambió: rehacerlo en cada consulta hace parpadear los escudos.
    var key = JSON.stringify([state.players, state.waiting]);
    if (key === boardKey) return;
    boardKey = key;
    var owner = {};
    state.players.forEach(function (p) { owner[p.team] = p; });
    var frag = document.createDocumentFragment();
    state.tiers.forEach(function (tier) {
      var col = el("div", "tier tier-" + tier.id);
      col.appendChild(el("h3", null, TIER_LABEL[tier.id] || tier.name));
      state.teams.filter(function (t) { return t.tier === tier.id; }).forEach(function (t) {
        var p = owner[t.id];
        var tile = el("div", "team-tile" + (p ? " taken" : ""));
        tile.dataset.team = t.id;
        tile.appendChild(S.crest(t));
        var info = el("div", "team-info");
        info.appendChild(el("b", null, t.name));
        if (p) {
          var who = el("span", "team-owner");
          who.appendChild(S.avatar(p, "avatar-xs"));
          who.appendChild(document.createTextNode(p.name + (p.locked ? " 🔒" : "")));
          info.appendChild(who);
        } else {
          info.appendChild(el("span", "team-owner muted", "Sobre cerrado"));
        }
        tile.appendChild(info);
        col.appendChild(tile);
      });
      frag.appendChild(col);
    });
    board.replaceChildren(frag);

    waiting.replaceChildren();
    if (state.waiting.length) {
      waiting.appendChild(el("h3", null, "Faltan abrir su sobre"));
      var list = el("div", "chips");
      state.waiting.forEach(function (p) {
        var chip = el("span", "chip");
        chip.appendChild(S.avatar(p, "avatar-xs"));
        chip.appendChild(document.createTextNode(p.name));
        list.appendChild(chip);
      });
      waiting.appendChild(list);
    } else if (state.players.length) {
      waiting.appendChild(el("h3", null, "Todos tienen equipo. ¡Que empiece el torneo!"));
    } else {
      waiting.appendChild(el("p", "muted", "Entran al sorteo los que confirmaron asistencia."));
    }
    renderAdminSelects();
  }

  /* ---------- Escenario ---------- */

  function playerBlock(p, label) {
    var b = el("div", "stage-player");
    var frame = el("div", "stage-photo");
    if (p.photo) { var img = document.createElement("img"); img.src = p.photo; img.alt = ""; frame.appendChild(img); }
    else frame.appendChild(el("span", "stage-initial", p.name.charAt(0)));
    b.appendChild(frame);
    if (label) b.appendChild(el("small", null, label));
    b.appendChild(el("strong", null, p.name));
    return b;
  }

  function revealBlock(team) {
    var r = el("div", "reveal tier-" + team.tier);
    r.appendChild(S.crest(team, "xl"));
    r.appendChild(el("small", null, TIER_LABEL[team.tier]));
    r.appendChild(el("strong", null, team.name));
    return r;
  }

  function staticEvent(ev) {
    stage.replaceChildren();
    if (!ev || ev.kind === "reset") {
      stage.appendChild(el("p", "stage-idle", state.players.length ? "Sorteo en curso" : "Esperando el primer sobre…"));
      return;
    }
    var team = teamOf(ev.team);
    if (!team) return;
    if (ev.kind === "draw") {
      var row = el("div", "stage-row");
      row.appendChild(playerBlock(playerOf(ev.num), "Abrió su sobre"));
      row.appendChild(revealBlock(team));
      stage.appendChild(row);
    } else {
      stage.appendChild(stealRow(ev, team));
    }
  }

  function stealRow(ev, team) {
    var row = el("div", "stage-row steal-row");
    row.appendChild(playerBlock(playerOf(ev.num), "Ladrón"));
    var mid = el("div", "steal-mid");
    mid.appendChild(el("div", "steal-stamp", "¡Robo!"));
    mid.appendChild(S.crest(team, "lg"));
    mid.appendChild(el("strong", null, team.name));
    row.appendChild(mid);
    row.appendChild(playerBlock(playerOf(ev.victim), "Víctima"));
    return row;
  }

  function playDraw(ev, box, done) {
    var team = teamOf(ev.team), p = playerOf(ev.num);
    box.replaceChildren();
    var row = el("div", "stage-row");
    var who = playerBlock(p, "Le toca a");
    var env = el("div", "envelope");
    env.appendChild(el("span", "envelope-flap"));
    env.appendChild(el("span", "envelope-q", "?"));
    row.appendChild(who);
    row.appendChild(env);
    box.appendChild(row);

    var tierColor = { oro: "#D4AF37", plata: "#C9D3E0", bronce: "#b0764a", maldito: "#9B2335" }[team.tier];
    gsap.timeline({ onComplete: done })
      .from(who, { x: -80, opacity: 0, duration: 0.5, ease: "back.out(1.6)" })
      .from(env, { y: 60, opacity: 0, rotation: -12, duration: 0.5, ease: "back.out(1.8)" }, "-=0.2")
      .to(env, { rotation: 4, duration: 0.07, yoyo: true, repeat: 15, ease: "none" }, "+=0.3")
      .to(env, { boxShadow: "0 0 70px 18px " + tierColor, duration: 0.7 }, "-=0.7")
      .to(env, { scale: 1.25, duration: 0.2, ease: "power2.in" })
      .to(env, { rotationY: 90, opacity: 0, duration: 0.2 })
      .add(function () {
        var rev = revealBlock(team);
        env.replaceWith(rev);
        gsap.from(rev, { scale: 0.3, rotation: -10, opacity: 0, duration: 0.6, ease: "back.out(2)" });
        if (team.tier === "maldito") {
          gsap.fromTo(rev, { x: 0 }, { x: 10, duration: 0.06, yoyo: true, repeat: 7, delay: 0.5, ease: "none", clearProps: "x" });
        } else if (FX) {
          setTimeout(function () { FX.popConfetti(rev, { particles: team.tier === "oro" ? 60 : 30, streamers: team.tier === "oro" ? 14 : 6 }); }, 250);
        }
      })
      .to({}, { duration: 1.4 });
  }

  function playSteal(ev, box, done) {
    var team = teamOf(ev.team);
    box.replaceChildren();
    var row = stealRow(ev, team);
    box.appendChild(row);
    var stamp = row.querySelector(".steal-stamp");
    var crest = row.querySelector(".steal-mid .crest");
    gsap.timeline({ onComplete: done })
      .from(row.children[0], { x: -80, opacity: 0, duration: 0.4 })
      .from(row.children[2], { x: 80, opacity: 0, duration: 0.4 }, "<")
      .fromTo(stamp, { scale: 3, opacity: 0, rotation: -25 }, { scale: 1, opacity: 1, rotation: -8, duration: 0.45, ease: "back.out(2.4)" })
      .fromTo(crest, { x: 160 }, { x: -160, duration: 0.8, ease: "power3.inOut" }, "+=0.3")
      .to(crest, { x: 0, duration: 0.4, ease: "power2.out" })
      .add(function () { if (FX) FX.popConfetti(row.children[0], { particles: 20, streamers: 4 }); })
      .to({}, { duration: 1.2 });
  }

  function apply(next) {
    var ev = next.last;
    var isNew = ev && shownEvent !== null && ev.id !== shownEvent;
    state = next;
    if (shownEvent === null) {           // primera carga: sin animación
      shownEvent = ev ? ev.id : 0;
      staticEvent(ev);
      renderBoard();
      return;
    }
    if (!isNew) { if (!busy) renderBoard(); return; }
    shownEvent = ev.id;
    if (!animate || ev.kind === "reset" || !teamOf(ev.team)) { staticEvent(ev); renderBoard(); highlight(ev); return; }
    busy = true;
    openOverlay();
    var finish = function () {
      closeOverlay(function () {
        busy = false;
        staticEvent(ev);
        renderBoard();
        highlight(ev);
      });
    };
    if (ev.kind === "draw") playDraw(ev, overlayStage, finish); else playSteal(ev, overlayStage, finish);
  }

  /* La animación corre en una capa a pantalla completa: se ve entera estés donde estés en la página. */
  var skipHold = null;

  function openOverlay() {
    overlay.hidden = false;
    document.body.classList.add("overlay-open");
    gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.25 });
  }

  function closeOverlay(after) {
    // Se deja el resultado a la vista un rato (o hasta que toquen la pantalla) y después se cierra.
    var closed = false;
    var close = function () {
      if (closed) return;
      closed = true;
      skipHold = null;
      gsap.to(overlay, { opacity: 0, duration: 0.35, onComplete: function () {
        overlay.hidden = true;
        overlayStage.replaceChildren();
        document.body.classList.remove("overlay-open");
        after();
      } });
    };
    skipHold = close;
    setTimeout(close, 2200);
  }

  overlay.addEventListener("click", function () { if (skipHold) skipHold(); });

  /** Marca en el tablero el equipo que acaba de salir (o los dos de un robo) y lo trae a la vista. */
  function highlight(ev) {
    if (!ev || ev.kind === "reset") return;
    var teams = [ev.team];
    if (ev.kind === "steal") {
      var victim = state.players.find(function (p) { return p.num === ev.victim; });
      if (victim) teams.push(victim.team);
    }
    var tiles = teams.map(function (id) { return board.querySelector('[data-team="' + id + '"]'); }).filter(Boolean);
    if (!tiles.length) return;
    var r = tiles[0].getBoundingClientRect();
    var bar = document.getElementById("admin");
    var bottom = window.innerHeight - (bar && !bar.hidden && bar.classList.contains("docked") ? bar.offsetHeight : 0);
    if (r.top < 60 || r.bottom > bottom) tiles[0].scrollIntoView({ behavior: animate ? "smooth" : "auto", block: "center" });
    tiles.forEach(function (t) {
      t.classList.add("just-drawn");
      if (animate) gsap.fromTo(t, { scale: 1 }, { scale: 1.06, duration: 0.25, yoyo: true, repeat: 3, ease: "power2.inOut", clearProps: "transform" });
      setTimeout(function () { t.classList.remove("just-drawn"); }, 6000);
    });
  }

  function load() {
    return S.api("/draw").then(apply).catch(function () { /* se reintenta en el próximo ciclo */ });
  }

  /* ---------- Admin ---------- */

  var adminOn = false, gate = null;
  var msg = document.getElementById("admin-msg");
  var thiefSel = document.getElementById("thief");
  var victimSel = document.getElementById("victim");

  function option(value, text) { var o = document.createElement("option"); o.value = value; o.textContent = text; return o; }

  function renderAdminSelects() {
    if (!adminOn || !state) return;
    var prevT = thiefSel.value, prevV = victimSel.value;
    thiefSel.replaceChildren(option("", "—"));
    victimSel.replaceChildren(option("", "—"));
    state.players.forEach(function (p) {
      var left = p.maxSteals - p.steals;
      if (left > 0) thiefSel.appendChild(option(p.num, p.name + " (" + left + ")"));
      if (!p.locked) victimSel.appendChild(option(p.num, p.name + " · " + (teamOf(p.team) || {}).name));
    });
    thiefSel.value = prevT; victimSel.value = prevV;
  }

  function run(btn, path, body) {
    btn.disabled = true;
    msg.textContent = "";
    S.adminPost(path, body).then(apply).catch(function (err) {
      msg.textContent = S.errorText(err);
      if (err.status === 401) gate.invalid();
    }).then(function () { btn.disabled = false; });
  }

  function initAdmin() {
    gate = S.adminGate(function (on) {
      adminOn = on;
      // Con el organizador adentro, los controles quedan fijos abajo de la pantalla.
      document.getElementById("admin").classList.toggle("docked", on);
      document.body.classList.toggle("has-dock", on);
      renderAdminSelects();
    });
    var next = document.getElementById("btn-next");
    next.addEventListener("click", function () { if (!busy) run(next, "/admin/draw/next"); });
    var steal = document.getElementById("btn-steal");
    steal.addEventListener("click", function () {
      if (!thiefSel.value || !victimSel.value) { msg.textContent = "Elegí ladrón y víctima."; return; }
      run(steal, "/admin/draw/steal", { thief: Number(thiefSel.value), victim: Number(victimSel.value) });
    });
    var reset = document.getElementById("btn-reset");
    reset.addEventListener("click", function () {
      if (window.confirm("¿Borrar todo el sorteo y volver a empezar?")) run(reset, "/admin/draw/reset");
    });
  }

  initAdmin();
  load();
  setInterval(function () { if (!document.hidden && !busy) load(); }, S.pollMs);
})();
