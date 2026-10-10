// La tanda de penales: el sorteo de equipos en vivo. Patea el primero de la fila; con gol elige equipo,
// si falla vuelve al final. Cada penal y cada elección se anima a pantalla completa en todas las pantallas.
(function () {
  "use strict";

  var S = window.Supremo, FX = window.Effects, gsap = window.gsap;
  var el = S.el;
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var animate = !!gsap && !reduced;
  var $ = function (id) { return document.getElementById(id); };

  var board = $("board"), waitingBox = $("waiting"), turnBox = $("turn"), lineBox = $("line");
  var overlay = $("overlay"), overlayStage = $("overlay-stage");

  var state = null;
  var shownEvent = null;   // id del último movimiento ya mostrado
  var busy = false;        // mientras corre una animación no se repinta nada (no spoilea)
  var me = null;           // invitado de este celular, si entró con su link
  var guestCode = readGuestCode();
  var adminOn = false, gate = null, sending = false;

  var RESULT = {
    gol: { title: "¡GOOOL!", cls: "gol" },
    atajada: { title: "¡LA ATAJÓ!", cls: "miss" },
    palo: { title: "¡AL PALO!", cls: "miss" },
    afuera: { title: "¡AFUERA!", cls: "miss" }
  };

  function readGuestCode() {
    var c = null;
    try { c = new URLSearchParams(window.location.search).get("c"); } catch (e) { /* sin URLSearchParams */ }
    try {
      if (c) localStorage.setItem("supremo-guest-code", c.trim().toUpperCase());
      else c = localStorage.getItem("supremo-guest-code");
    } catch (e) { /* sin storage: solo vale el de la URL */ }
    return c ? c.trim().toUpperCase() : null;
  }

  function teamOf(id) { return state.teams.find(function (t) { return t.id === id; }) || null; }
  function personOf(num) {
    return state.queue.find(function (p) { return p.num === num; }) ||
      state.players.find(function (p) { return p.num === num; }) || { num: num, name: "#" + num };
  }

  /* ---------- Tablero de equipos ---------- */

  var boardKey = "";

  function renderBoard() {
    // Solo se repinta si algo cambió: rehacerlo en cada consulta hace parpadear los escudos.
    var key = JSON.stringify(state.players);
    if (key === boardKey) return;
    boardKey = key;
    var owner = {};
    state.players.forEach(function (p) { owner[p.team] = p; });
    var frag = document.createDocumentFragment();
    state.teams.forEach(function (t) {
        var p = owner[t.id];
        var tile = el("div", "team-tile" + (p ? " taken" : ""));
        tile.dataset.team = t.id;
        tile.appendChild(S.crest(t));
        var info = el("div", "team-info");
        info.appendChild(el("b", null, t.name));
        if (p) {
          var who = el("span", "team-owner");
          who.appendChild(S.avatar(p, "avatar-xs"));
          who.appendChild(document.createTextNode(p.name));
          info.appendChild(who);
        } else {
          info.appendChild(el("span", "team-owner muted", "Disponible"));
        }
        tile.appendChild(info);
        frag.appendChild(tile);
    });
    board.replaceChildren(frag);
  }

  /* ---------- Fixture: las casillas de la ronda ---------- */

  var ringBox = $("ring"), ringKey = "";

  function slotIndex(num) {
    for (var i = 0; i < state.slots.length; i++) if (state.slots[i].num === num) return i;
    return -1;
  }
  function neighbors(i) {
    var n = state.slots.length;
    return n < 2 ? [] : n === 2 ? [state.slots[1 - i]] : [state.slots[(i - 1 + n) % n], state.slots[(i + 1) % n]];
  }
  function slotName(sl) {
    var p = sl.num != null ? personOf(sl.num) : null;
    return p ? p.name : "casilla " + (state.slots.indexOf(sl) + 1) + " (libre)";
  }
  function rivalsText(i) {
    var r = neighbors(i).map(slotName);
    return r.length === 2 ? r[0] + " y " + r[1] : r.join("");
  }
  function canRemoveSlot() {
    return state.slots.length - 1 >= state.players.length + state.queue.length;
  }

  /** Las casillas como nodos del zigzag; extra(sl, i) agrega lo propio de cada uso (tocar, sacar). */
  function zigzagNodes(extra) {
    return state.slots.map(function (sl, i) {
      var p = sl.num != null ? state.players.find(function (x) { return x.num === sl.num; }) : null;
      var nd = { label: String(i + 1), person: p, team: p ? teamOf(p.team) : null, free: !p, mine: !!(me && p && p.num === me.num) };
      return extra ? Object.assign(nd, extra(sl, i)) : nd;
    });
  }

  function renderRing() {
    var key = JSON.stringify([state.slots, state.players, adminOn, state.queue.length]);
    if (key === ringKey) return;
    ringKey = key;
    var wrap = $("ring-wrap");
    wrap.hidden = !state.slots.length;
    if (!state.slots.length) return;
    $("ring-note").textContent = state.slots.length < 8
      ? "Con menos de 8 jugadores todos juegan contra todos: la casilla no cambia los rivales."
      : "Cada casilla juega contra la de al lado de cada lado (la última contra la primera). Al meter el gol elegís equipo y casilla.";
    var removable = adminOn && canRemoveSlot();
    ringBox.replaceChildren(S.zigzag({ nodes: zigzagNodes(function (sl, i) {
      if (!removable || sl.num != null || sl.pending) return {};
      return { onRemove: function () {
        if (window.confirm("¿Sacar la casilla " + (i + 1) + "? Las de al lado pasan a jugar entre ellas.")) adminAction("/admin/draw/remove-slot", { slot: sl.slot });
      } };
    }) }));
  }

  /* ---------- Turno y fila ---------- */

  function renderTurn() {
    turnBox.replaceChildren();
    lineBox.replaceChildren();
    var cur = state.current != null ? personOf(state.current) : null;

    if (state.phase === "idle") {
      turnBox.appendChild(el("p", "stage-idle", "Esperando que arranque el sorteo…"));
    } else if (state.phase === "done") {
      turnBox.appendChild(el("p", "stage-idle", "Todos tienen equipo. ¡Que empiece el torneo!"));
    } else {
      var row = el("div", "turn-row");
      row.appendChild(S.avatar(cur, "avatar-lg"));
      var txt = el("div", "turn-text");
      txt.appendChild(el("small", null, state.phase === "pick" ? "¡Hizo el gol! Está eligiendo equipo" : "Patea"));
      txt.appendChild(el("strong", null, cur.name));
      row.appendChild(txt);
      turnBox.appendChild(row);
    }

    if (state.queue.length && state.phase !== "idle") {
      lineBox.appendChild(el("h3", null, "La fila"));
      var chips = el("ol", "chips line-chips");
      state.queue.forEach(function (p, i) {
        var chip = el("li", "chip" + (p.num === state.current ? " now" : "") + (me && p.num === me.num ? " mine" : ""));
        chip.appendChild(el("span", "chip-pos", String(i + 1)));
        chip.appendChild(S.avatar(p, "avatar-xs"));
        chip.appendChild(document.createTextNode(p.name));
        if (adminOn && !(state.phase === "pick" && p.num === state.current)) {
          var x = el("button", "chip-x", "✕");
          x.type = "button";
          x.title = "No vino";
          x.addEventListener("click", function () {
            if (window.confirm("¿" + p.name + " no vino? Sale de la fila (queda como que no asiste).")) adminAction("/admin/draw/absent", { num: p.num });
          });
          chip.appendChild(x);
        }
        chips.appendChild(chip);
      });
      lineBox.appendChild(chips);
    }

    waitingBox.replaceChildren();
    if (state.phase === "idle") {
      if (state.waiting.length) {
        waitingBox.appendChild(el("h3", null, "Entran al sorteo"));
        var list = el("div", "chips");
        state.waiting.forEach(function (p) {
          var chip = el("span", "chip");
          chip.appendChild(S.avatar(p, "avatar-xs"));
          chip.appendChild(document.createTextNode(p.name));
          list.appendChild(chip);
        });
        waitingBox.appendChild(list);
      } else {
        waitingBox.appendChild(el("p", "muted", "Entran al sorteo los que confirmaron asistencia."));
      }
    }
  }

  /* ---------- Controles: patear y elegir ---------- */

  function canControl() {
    if (!state || (state.phase !== "shoot" && state.phase !== "pick")) return false;
    return adminOn || !!(me && me.num === state.current);
  }

  /*
   * Al que le toca (o al organizador) se le abre la misma tarjeta centrada de las animaciones:
   * su foto y el arco grande, y toca directo el lugar donde patea. Con gol, ahí mismo elige equipo.
   */
  var playKey = "", hiddenKey = null, pickTeam = null;

  function renderPlay() {
    $("btn-start").hidden = !adminOn || !state || state.phase !== "idle";
    document.body.classList.toggle("has-dock", adminOn);
    var reopen = $("reopen");
    if (!canControl() || busy) { playKey = ""; reopen.hidden = true; closeControl(); return; }

    var key = state.phase + ":" + state.current + ":" + state.players.length;
    var who = personOf(state.current);
    if (hiddenKey === key) {
      // El organizador la escondió para mirar el tablero: queda un botón para volver a abrirla.
      closeControl();
      reopen.hidden = false;
      reopen.textContent = (state.phase === "shoot" ? "⚽ Patea " : "🏆 Elige ") + who.name;
      return;
    }
    hiddenKey = null;
    reopen.hidden = true;
    if (key === playKey && overlay.classList.contains("control") && !overlay.hidden) return;
    if (key !== playKey) pickTeam = null;
    playKey = key;
    buildControl(who);
  }

  function buildControl(who) {
    var wasHidden = overlay.hidden;
    var mine = !adminOn || (me && me.num === state.current);
    gsap && gsap.killTweensOf(overlayStage.querySelectorAll(".keeper"));
    overlayStage.replaceChildren();
    overlay.classList.add("control");
    overlay.hidden = false;
    document.body.classList.add("overlay-open");

    var wrap = el("div", "shot control");
    var row = el("div", "stage-row shot-row");
    if (state.phase === "shoot") {
      row.appendChild(playerBlock(who, mine ? "¡Te toca!" : "Patea"));
      var g = buildGoal();
      var goalBox = el("div", "shot-goal");
      goalBox.appendChild(g.svg);
      var layer = el("div", "zone-layer");
      [["tl", "Ángulo izquierdo"], ["c", "Al medio"], ["tr", "Ángulo derecho"], ["bl", "Abajo a la izquierda"], ["br", "Abajo a la derecha"]].forEach(function (z) {
        var b = el("button", "zone zone-" + z[0]);
        b.type = "button";
        b.title = z[1];
        b.setAttribute("aria-label", "Patear " + z[1].toLowerCase());
        b.appendChild(el("span", null, "⚽"));
        b.addEventListener("click", function () { send("/draw/shoot", { zone: z[0], expect: state.current }); });
        layer.appendChild(b);
      });
      goalBox.appendChild(layer);
      row.appendChild(goalBox);
      wrap.appendChild(row);
      wrap.appendChild(el("p", "shot-sub", "Tocá en el arco dónde querés patear"));
      if (animate) {
        gsap.set(g.ball, { x: 160, y: 192, scale: 1.25, svgOrigin: "0 0" });
        gsap.to(g.keeper, { x: 8, duration: 0.6, yoyo: true, repeat: -1, ease: "sine.inOut" });
      } else {
        g.ball.setAttribute("transform", "translate(160 192) scale(1.25)");
      }
    } else if (!pickTeam) {
      // Con gol, primero el equipo…
      row.appendChild(playerBlock(who, mine ? "¡Gol! Elegí tu equipo" : "¡Gol! Elige equipo"));
      var taken = {};
      state.players.forEach(function (p) { taken[p.team] = true; });
      var grid = el("div", "team-pick");
      state.teams.filter(function (t) { return !taken[t.id]; }).forEach(function (t) {
        var b = el("button", "pick-btn");
        b.type = "button";
        b.appendChild(S.crest(t));
        b.appendChild(el("span", null, t.name));
        b.addEventListener("click", function () { pickTeam = t.id; buildControl(who); });
        grid.appendChild(b);
      });
      row.appendChild(grid);
      wrap.appendChild(row);
    } else {
      // …y después la casilla, viendo contra quién jugaría en cada una.
      var team = teamOf(pickTeam);
      row.appendChild(playerBlock(who, mine ? "Elegí tu casilla" : "Elige casilla"));
      var side = el("div", "slot-pick");
      var chosen = el("div", "slot-pick-team");
      chosen.appendChild(S.crest(team));
      chosen.appendChild(el("b", null, team.name));
      var change = el("button", "btn-link", "Cambiar equipo");
      change.type = "button";
      change.addEventListener("click", function () { pickTeam = null; buildControl(who); });
      chosen.appendChild(change);
      side.appendChild(chosen);
      side.appendChild(el("p", "slot-help", "Tocá una casilla libre: las dos líneas que salen de ella son tus dos partidos."));
      side.appendChild(S.zigzag({ nodes: zigzagNodes(function (sl, i) {
        if (sl.num != null) return {};
        return { onClick: function () {
          var msg = "¿" + team.name + " en la casilla " + (i + 1) + "?" + (state.slots.length >= 8 ? " Jugás contra " + rivalsText(i) + "." : "");
          if (window.confirm(msg)) send("/draw/pick", { team: team.id, slot: sl.slot, expect: state.current });
        } };
      }) }));
      row.appendChild(side);
      wrap.appendChild(row);
    }
    if (adminOn) {
      var hide = el("button", "btn-link control-hide", "Esconder para ver el tablero");
      hide.type = "button";
      hide.addEventListener("click", function () { hiddenKey = playKey; renderPlay(); });
      wrap.appendChild(hide);
    }
    overlayStage.appendChild(wrap);
    if (animate && wasHidden) {
      gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.25 });
      gsap.fromTo(overlayStage, { scale: 0.85, y: 30, opacity: 0 }, { scale: 1, y: 0, opacity: 1, duration: 0.4, ease: "back.out(1.6)" });
    }
  }

  function closeControl() {
    if (!overlay.classList.contains("control")) return;
    if (gsap) gsap.killTweensOf(overlayStage.querySelectorAll(".keeper"));
    overlay.classList.remove("control");
    overlay.hidden = true;
    overlayStage.replaceChildren();
    document.body.classList.remove("overlay-open");
  }

  function send(path, body) {
    if (sending) return;
    sending = true;
    var msg = $("admin-msg");
    msg.textContent = "";
    var headers = { "content-type": "application/json" };
    if (adminOn) headers["x-admin-token"] = S.getToken();
    else if (guestCode) headers["x-guest-code"] = guestCode;
    Array.prototype.forEach.call(overlayStage.querySelectorAll("button"), function (b) { b.disabled = true; });
    S.api(path, { method: "POST", headers: headers, body: JSON.stringify(body) })
      .then(apply)
      .catch(function (err) {
        var text = S.errorText(err);
        if (adminOn) { msg.textContent = text; if (err.status === 401) gate.invalid(); }
        else window.alert(text);
        playKey = "";
        if (overlay.classList.contains("control")) Array.prototype.forEach.call(overlayStage.querySelectorAll("button"), function (b) { b.disabled = false; });
        load();
      })
      .then(function () { sending = false; });
  }

  /* ---------- Animaciones: una tarjeta centrada encima de todo ---------- */

  var skipHold = null;

  function openOverlay() {
    overlay.hidden = false;
    document.body.classList.add("overlay-open");
    gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.25 });
    gsap.fromTo(overlayStage, { scale: 0.85, y: 30, opacity: 0 }, { scale: 1, y: 0, opacity: 1, duration: 0.4, ease: "back.out(1.6)" });
  }

  function closeOverlay(hold, after) {
    // El resultado queda a la vista un rato (o hasta que toquen la pantalla) y después se cierra.
    var closed = false;
    var close = function () {
      if (closed) return;
      closed = true;
      skipHold = null;
      gsap.to(overlayStage, { scale: 0.9, opacity: 0, duration: 0.3, ease: "power2.in" });
      gsap.to(overlay, { opacity: 0, duration: 0.35, delay: 0.05, onComplete: function () {
        overlay.hidden = true;
        overlayStage.replaceChildren();
        document.body.classList.remove("overlay-open");
        after();
      } });
    };
    skipHold = close;
    setTimeout(close, hold);
  }

  overlay.addEventListener("click", function () { if (skipHold) skipHold(); });

  /** Foto grande del jugador con su nombre, como la del sobre. */
  function playerBlock(p, label) {
    var who = el("div", "stage-player");
    var frame = el("div", "stage-photo");
    if (p.photo) { var img = document.createElement("img"); img.src = p.photo; img.alt = ""; frame.appendChild(img); }
    else frame.appendChild(el("span", "stage-initial", p.name.charAt(0)));
    who.appendChild(frame);
    who.appendChild(el("small", null, label));
    who.appendChild(el("strong", null, p.name));
    return who;
  }

  var SVGNS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  /** Arco, arquero y pelota en SVG (viewBox 320x210). */
  function buildGoal() {
    var svg = svgEl("svg", { viewBox: "0 0 320 210", "class": "goal-svg", "aria-hidden": "true" });
    svg.appendChild(svgEl("rect", { x: 0, y: 150, width: 320, height: 60, fill: "#2f6b3a" }));
    svg.appendChild(svgEl("rect", { x: 0, y: 150, width: 320, height: 3, fill: "rgba(255,255,255,.5)" }));
    var net = svgEl("g", { "class": "net", stroke: "rgba(255,255,255,.28)", "stroke-width": 1 });
    for (var x = 40; x < 290; x += 12) net.appendChild(svgEl("line", { x1: x, y1: 32, x2: x, y2: 150 }));
    for (var y = 40; y < 150; y += 12) net.appendChild(svgEl("line", { x1: 32, y1: y, x2: 288, y2: y }));
    svg.appendChild(net);
    svg.appendChild(svgEl("path", { d: "M30 150 V30 H290 V150", fill: "none", stroke: "#fff", "stroke-width": 6, "stroke-linejoin": "round" }));

    var keeper = svgEl("g", { "class": "keeper" });
    keeper.appendChild(svgEl("rect", { x: 150, y: 104, width: 20, height: 30, rx: 5, fill: "#D4AF37", stroke: "#141414", "stroke-width": 2 }));
    keeper.appendChild(svgEl("rect", { x: 132, y: 106, width: 18, height: 7, rx: 3, fill: "#D4AF37", stroke: "#141414", "stroke-width": 2 }));
    keeper.appendChild(svgEl("rect", { x: 170, y: 106, width: 18, height: 7, rx: 3, fill: "#D4AF37", stroke: "#141414", "stroke-width": 2 }));
    keeper.appendChild(svgEl("circle", { cx: 128, cy: 109, r: 5, fill: "#EDE3CC", stroke: "#141414", "stroke-width": 2 }));
    keeper.appendChild(svgEl("circle", { cx: 192, cy: 109, r: 5, fill: "#EDE3CC", stroke: "#141414", "stroke-width": 2 }));
    keeper.appendChild(svgEl("rect", { x: 151, y: 133, width: 7, height: 17, fill: "#141414" }));
    keeper.appendChild(svgEl("rect", { x: 162, y: 133, width: 7, height: 17, fill: "#141414" }));
    keeper.appendChild(svgEl("circle", { cx: 160, cy: 95, r: 9, fill: "#c99a6b", stroke: "#141414", "stroke-width": 2 }));
    svg.appendChild(keeper);

    var ball = svgEl("g", { "class": "ball" });
    ball.appendChild(svgEl("circle", { cx: 0, cy: 0, r: 9, fill: "#fff", stroke: "#141414", "stroke-width": 2 }));
    ball.appendChild(svgEl("path", { d: "M0 -4 L4 -1 L2.5 4 L-2.5 4 L-4 -1 Z", fill: "#141414" }));
    svg.appendChild(ball);
    return { svg: svg, keeper: keeper, ball: ball };
  }

  var TARGET = { tl: [62, 52], bl: [62, 132], c: [160, 92], tr: [258, 52], br: [258, 132] };
  var DIVE = {
    L: { x: -78, y: -6, rotation: -72 },
    C: { x: 0, y: -22, rotation: 0 },
    R: { x: 78, y: -6, rotation: 72 }
  };

  function playShot(ev, done) {
    var p = personOf(ev.num), res = RESULT[ev.result] || RESULT.atajada;
    overlayStage.replaceChildren();
    var wrap = el("div", "shot");
    var who = playerBlock(p, "Patea");
    var g = buildGoal();
    var goalBox = el("div", "shot-goal");
    goalBox.appendChild(g.svg);
    var row = el("div", "stage-row shot-row");
    row.appendChild(who);
    row.appendChild(goalBox);
    wrap.appendChild(row);
    var banner = el("div", "shot-result " + res.cls, res.title);
    var sub = el("p", "shot-sub", ev.result === "gol" ? "Ahora elige su equipo" : p.name + " vuelve al final de la fila");
    wrap.appendChild(banner);
    wrap.appendChild(sub);
    overlayStage.appendChild(wrap);

    var t = TARGET[ev.zone] || TARGET.c;
    var left = ev.zone === "tl" || ev.zone === "bl";
    var end = { x: t[0], y: t[1] };
    if (ev.result === "afuera") end = { x: left ? 46 : 274, y: 6 };
    if (ev.result === "palo") end = { x: left ? 32 : 288, y: 48 };

    gsap.set(g.ball, { x: 160, y: 192, scale: 1.25, svgOrigin: "0 0" });
    gsap.set(g.keeper, { svgOrigin: "160 150" });
    gsap.set([banner, sub], { opacity: 0 });
    var tl = gsap.timeline({ onComplete: done });
    tl.from(who, { x: -80, opacity: 0, duration: 0.5, ease: "back.out(1.6)" }, 0.2)
      .from(goalBox, { y: 60, opacity: 0, rotation: -6, duration: 0.5, ease: "back.out(1.8)" }, "-=0.25")
      .to(g.keeper, { x: 6, duration: 0.25, yoyo: true, repeat: 3, ease: "sine.inOut" })
      .to(g.ball, { x: end.x, y: end.y, scale: 0.75, duration: 0.45, ease: "power2.in" }, "+=0.25")
      .to(g.keeper, Object.assign({ duration: 0.38, ease: "power2.out" }, DIVE[ev.dive] || DIVE.C), "<+0.05");

    if (ev.result === "gol") {
      tl.to(g.svg.querySelector(".net"), { y: -4, duration: 0.08, yoyo: true, repeat: 3 })
        .add(function () { if (FX) FX.popConfetti(banner, { particles: 60, streamers: 12 }); });
    } else if (ev.result === "atajada") {
      tl.to(g.ball, { x: end.x + (left ? 40 : ev.zone === "c" ? 0 : -40), y: 185, duration: 0.45, ease: "power2.out" });
    } else if (ev.result === "palo") {
      tl.to(g.svg, { x: 3, duration: 0.05, yoyo: true, repeat: 5 })
        .to(g.ball, { x: left ? 80 : 240, y: 190, duration: 0.5, ease: "bounce.out" }, "<");
    } else {
      tl.to(g.ball, { x: left ? 20 : 300, y: -20, scale: 0.5, duration: 0.3 });
    }
    tl.fromTo(banner, { scale: 2.4, opacity: 0, rotation: -8 }, { scale: 1, opacity: 1, rotation: -4, duration: 0.4, ease: "back.out(2.2)" })
      .to(sub, { opacity: 1, duration: 0.3 });
  }

  function revealBlock(team, note) {
    var r = el("div", "reveal");
    r.appendChild(S.crest(team, "xl"));
    r.appendChild(el("strong", null, team.name));
    if (note) r.appendChild(el("small", null, note));
    return r;
  }

  function playPick(ev, done) {
    var team = teamOf(ev.team), p = personOf(ev.num);
    overlayStage.replaceChildren();
    var row = el("div", "stage-row");
    var who = playerBlock(p, "Eligió");
    var i = slotIndex(ev.num);
    var note = i < 0 ? "" : "Casilla " + (i + 1) + (state.slots.length >= 8 ? " · juega con " + rivalsText(i) : "");
    var rev = revealBlock(team, note);
    row.appendChild(who);
    row.appendChild(rev);
    overlayStage.appendChild(row);
    gsap.timeline({ onComplete: done })
      .from(who, { x: -80, opacity: 0, duration: 0.45, ease: "back.out(1.6)" }, 0.2)
      .from(rev, { scale: 0.3, rotation: -10, opacity: 0, duration: 0.6, ease: "back.out(2)" }, "-=0.1")
      .add(function () { if (FX) FX.popConfetti(rev, { particles: 50, streamers: 10 }); });
  }

  function playStart(done) {
    overlayStage.replaceChildren();
    var box = el("div", "start-box");
    box.appendChild(el("p", "shot-result gol", "¡Arranca la tanda!"));
    var chips = el("ol", "chips line-chips");
    state.queue.forEach(function (p, i) {
      var chip = el("li", "chip" + (i === 0 ? " now" : ""));
      chip.appendChild(el("span", "chip-pos", String(i + 1)));
      chip.appendChild(S.avatar(p, "avatar-xs"));
      chip.appendChild(document.createTextNode(p.name));
      chips.appendChild(chip);
    });
    box.appendChild(chips);
    overlayStage.appendChild(box);
    gsap.timeline({ onComplete: done })
      .from(box.firstChild, { scale: 2, opacity: 0, duration: 0.4, ease: "back.out(2)" })
      .from(chips.children, { y: 20, opacity: 0, duration: 0.3, stagger: 0.08 });
  }

  /** Marca en el tablero el equipo recién elegido y lo trae a la vista. */
  function highlight(ev) {
    if (!ev || ev.kind !== "pick") return;
    var tile = board.querySelector('[data-team="' + ev.team + '"]');
    if (!tile) return;
    var r = tile.getBoundingClientRect();
    var dock = document.body.classList.contains("has-dock") ? 200 : 0;
    if (r.top < 60 || r.bottom > window.innerHeight - dock) tile.scrollIntoView({ behavior: animate ? "smooth" : "auto", block: "center" });
    tile.classList.add("just-drawn");
    if (animate) gsap.fromTo(tile, { scale: 1 }, { scale: 1.06, duration: 0.25, yoyo: true, repeat: 3, ease: "power2.inOut", clearProps: "transform" });
    setTimeout(function () { tile.classList.remove("just-drawn"); }, 6000);
  }

  function renderAll() { renderTurn(); renderBoard(); renderRing(); renderPlay(); }

  function adminAction(path, body) {
    $("admin-msg").textContent = "";
    S.adminPost(path, body).then(apply).catch(function (err) {
      $("admin-msg").textContent = S.errorText(err);
      if (err.status === 401) gate.invalid();
    });
  }

  function apply(next) {
    var ev = next.last;
    var isNew = ev && shownEvent !== null && ev.id !== shownEvent;
    state = next;
    if (shownEvent === null || !isNew) {           // primera carga o nada nuevo: sin animación
      if (shownEvent === null) shownEvent = ev ? ev.id : 0;
      if (!busy) renderAll();
      return;
    }
    shownEvent = ev.id;
    if (!animate || ev.kind === "reset") { renderAll(); highlight(ev); return; }
    busy = true;
    $("reopen").hidden = true;
    var fromControl = overlay.classList.contains("control") && !overlay.hidden;
    if (fromControl) {                             // la tarjeta ya está abierta: la animación sigue ahí
      if (gsap) gsap.killTweensOf(overlayStage.querySelectorAll(".keeper"));
      overlay.classList.remove("control");
    } else {
      closeControl();
      openOverlay();
    }
    var finish = function (hold) {
      return function () {
        closeOverlay(hold, function () { busy = false; renderAll(); highlight(ev); });
      };
    };
    if (ev.kind === "shot") playShot(ev, finish(2400));
    else if (ev.kind === "pick" && teamOf(ev.team)) playPick(ev, finish(2200));
    else if (ev.kind === "start") playStart(finish(2600));
    else { busy = false; overlay.hidden = true; document.body.classList.remove("overlay-open"); renderAll(); }
  }

  function load() {
    return S.api("/draw").then(apply).catch(function () { /* se reintenta en el próximo ciclo */ });
  }

  /* ---------- Organizador ---------- */

  function adminRun(btn, path) {
    btn.disabled = true;
    $("admin-msg").textContent = "";
    S.adminPost(path).then(apply).catch(function (err) {
      $("admin-msg").textContent = S.errorText(err);
      if (err.status === 401) gate.invalid();
    }).then(function () { btn.disabled = false; });
  }

  function initAdmin() {
    gate = S.adminGate(function (on) {
      adminOn = on;
      // Con el organizador adentro, el panel queda fijo abajo de la pantalla.
      $("admin").classList.toggle("docked", on);
      playKey = "";
      hiddenKey = null;
      ringKey = "";
      if (state && !busy) renderAll();
    });
    $("btn-start").addEventListener("click", function () {
      if (window.confirm("¿Arrancar el sorteo con los que confirmaron? Se sortea el orden de la fila.")) adminRun($("btn-start"), "/draw/start");
    });
    $("btn-reset").addEventListener("click", function () {
      if (window.confirm("¿Borrar todo el sorteo y volver a empezar?")) adminRun($("btn-reset"), "/admin/draw/reset");
    });
  }

  $("reopen").addEventListener("click", function () { hiddenKey = null; playKey = ""; renderPlay(); });

  function initGuest() {
    if (!guestCode) return;
    S.api("/me?c=" + encodeURIComponent(guestCode)).then(function (g) {
      if (g.status !== "yes") return;
      me = g;
      playKey = "";
      if (state && !busy) renderAll();
    }).catch(function () { /* código inválido: mira como cualquiera */ });
  }

  initAdmin();
  initGuest();
  load();
  setInterval(function () { if (!document.hidden && !busy) load(); }, S.pollMs);
})();
