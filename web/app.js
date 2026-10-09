(function () {
  "use strict";

  var cfg = window.APP_CONFIG || {};
  var API = cfg.apiBase || "/api";
  var POLL_MS = cfg.pollMs || 15000;
  var TOTAL = cfg.totalGuests || 16;
  var SLOT_COLORS = ["#c9b48a", "#8fa3b8", "#b5776a", "#a8a07a", "#7f93a6", "#c29a6b", "#9b8aa6", "#87a08a"];

  var grid = document.getElementById("grid");
  var counter = document.getElementById("counter");
  var loadError = document.getElementById("load-error");

  var code = readCode();
  var me = null;            // { num, name, status } del invitado del link
  var lastStatus = {};      // num -> status, para animar solo lo que cambia
  var lastTeam = {};        // num -> id del equipo sorteado, para repintar la card cuando le toca
  var firstRender = true;

  function readCode() {
    try {
      var c = new URLSearchParams(window.location.search).get("c");
      return c ? c.trim().toUpperCase() : null;
    } catch (e) { return null; }
  }

  function api(path, opts) {
    return fetch(API + path, Object.assign({ headers: { "content-type": "application/json" } }, opts || {}))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok) { var err = new Error(body.error || ("HTTP " + r.status)); err.status = r.status; throw err; }
          return body;
        });
      });
  }

  /* ---------- Cards ---------- */

  function silhouetteSVG() {
    return '<svg class="silhouette" viewBox="0 0 100 120" aria-hidden="true">' +
      '<circle cx="50" cy="42" r="22" fill="#141414" opacity="0.55"></circle>' +
      '<path d="M8 120 C10 84 30 72 50 72 C70 72 90 84 92 120 Z" fill="#141414" opacity="0.55"></path></svg>';
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function buildCard(g) {
    var status = g.status || "pending";
    var card = el("article", "card " + status);
    if (me && me.num === g.num) card.classList.add("is-me");

    var frame = el("div", "frame");
    frame.style.setProperty("--slot", SLOT_COLORS[(g.num - 1) % SLOT_COLORS.length]);
    frame.appendChild(el("div", "pitch"));

    if (status !== "pending" && g.photo) {
      var img = document.createElement("img");
      img.src = g.photo;
      img.alt = "Ilustración de " + g.name;
      img.loading = "lazy";
      frame.appendChild(img);
    } else {
      frame.insertAdjacentHTML("beforeend", silhouetteSVG());
      if (status === "pending") frame.appendChild(el("div", "mystery", "?"));
    }

    var badge = el("div", "badge");
    badge.appendChild(el("b", null, "#" + g.num));
    badge.appendChild(el("small", null, "FIFA 26"));
    frame.appendChild(badge);

    if (status === "yes") frame.appendChild(el("div", "stamp yes", "Confirmado"));
    if (status === "no") frame.appendChild(el("div", "stamp no", "Rechazado"));

    card.appendChild(frame);
    card.appendChild(el("h3", "card-name", status === "pending" ? "Convocado #" + g.num : g.name));
    if (status === "yes" && g.team) {
      var team = el("p", "card-team");
      if (window.Supremo) team.appendChild(window.Supremo.crest(g.team, "sm"));
      team.appendChild(document.createTextNode(g.team.name));
      card.appendChild(team);
    }
    card.appendChild(el("p", "card-status",
      status === "yes" ? "Presente. Que tiemble el resto." :
      status === "no" ? "Se bajó del torneo" :
      "Esperando respuesta"));

    card.dataset.num = g.num;
    card.dataset.status = status;
    return card;
  }

  var FX = window.Effects || null;
  var cardEls = {};          // num -> elemento actual
  var confirmedShown = 0;
  var fmtCounter = function (n) { return n + " / " + TOTAL + " confirmados"; };

  function render(guests) {
    var byNum = {};
    guests.forEach(function (g) { byNum[g.num] = g; });
    var confirmed = 0;

    if (firstRender) {
      var frag = document.createDocumentFragment();
      for (var n = 1; n <= TOTAL; n++) {
        var g = byNum[n] || { num: n, status: "pending" };
        if (g.status === "yes") confirmed++;
        cardEls[n] = buildCard(g);
        frag.appendChild(cardEls[n]);
      }
      grid.replaceChildren(frag);
      if (FX) FX.dealCards(Array.prototype.slice.call(grid.children));
    } else {
      for (var m = 1; m <= TOTAL; m++) {
        var gg = byNum[m] || { num: m, status: "pending" };
        if (gg.status === "yes") confirmed++;
        var prev = lastStatus[m] || "pending";
        var isMeNow = !!(me && me.num === m);
        var wasMe = cardEls[m].classList.contains("is-me");
        var teamNow = gg.team ? gg.team.id : null;
        if (prev === gg.status && isMeNow === wasMe && (lastTeam[m] || null) === teamNow) continue;
        var fresh = buildCard(gg);
        if (prev !== gg.status && FX) FX.flipReveal(cardEls[m], fresh, gg.status);
        else cardEls[m].replaceWith(fresh);
        cardEls[m] = fresh;
      }
    }

    if (FX) FX.countTo(counter, confirmedShown, confirmed, fmtCounter);
    else counter.textContent = fmtCounter(confirmed);
    confirmedShown = confirmed;
    for (var k = 1; k <= TOTAL; k++) {
      lastStatus[k] = (byNum[k] && byNum[k].status) || "pending";
      lastTeam[k] = (byNum[k] && byNum[k].team && byNum[k].team.id) || null;
    }
    firstRender = false;
  }

  function load() {
    return api("/rsvps").then(function (body) {
      loadError.hidden = true;
      render(body.guests || []);
    }).catch(function () {
      loadError.hidden = false;
      if (firstRender) render([]);
    });
  }

  /* ---------- Invitación personal ---------- */

  var inviteSec = document.getElementById("invitacion");
  var inviteTitle = document.getElementById("invite-title");
  var inviteText = document.getElementById("invite-text");
  var inviteMsg = document.getElementById("invite-msg");
  var buttons = Array.prototype.slice.call(document.querySelectorAll("#invite-actions .btn"));

  function paintInvite() {
    inviteTitle.textContent = "Hola, " + me.name;
    if (me.status === "yes") {
      inviteText.textContent = "Ya estás confirmado para el domingo 18. Si algo cambia, podés bajarte acá abajo.";
    } else if (me.status === "no") {
      inviteText.textContent = "Marcaste que no venís. Si te liberás, todavía podés confirmar.";
    } else {
      inviteText.textContent = "Estás convocado al torneo que define al Supremo Papá del FIFA 2026. ¿Te presentás?";
    }
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.status === me.status)); });
    // Con el mismo link se patea en el sorteo de equipos: queda guardado en este celular.
    var toDraw = document.getElementById("invite-sorteo");
    toDraw.hidden = me.status !== "yes";
    toDraw.href = "/sorteo?c=" + encodeURIComponent(code);
    try { localStorage.setItem("supremo-guest-code", code); } catch (e) { /* sin storage: queda el link */ }
  }

  function answer(status, btn) {
    if (FX && btn) FX.press(btn);
    buttons.forEach(function (b) { b.disabled = true; });
    inviteMsg.textContent = "Guardando…";
    api("/rsvp", { method: "POST", body: JSON.stringify({ code: code, status: status }) })
      .then(function (g) {
        me = g;
        paintInvite();
        inviteMsg.textContent = status === "yes" ? "Confirmado. Tu card ya está a la vista de todos." : "Listo, registramos que no venís.";
        if (FX && status === "yes" && btn) FX.popConfetti(btn, { direction: "up", particles: 36, streamers: 10 });
        return load().then(function () {
          var mine = cardEls[me.num];
          if (mine && mine.scrollIntoView) mine.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      })
      .catch(function (err) {
        inviteMsg.textContent = err.status === 404
          ? "Este link no corresponde a ningún invitado. Pedile el tuyo al organizador."
          : "No se pudo guardar tu respuesta. Probá de nuevo en un momento.";
      })
      .then(function () { buttons.forEach(function (b) { b.disabled = false; }); });
  }

  function initInvite() {
    if (!code) return;
    inviteSec.hidden = false;
    inviteTitle.textContent = "Cargando tu convocatoria…";
    buttons.forEach(function (b) {
      b.disabled = true;
      b.addEventListener("click", function () { answer(b.dataset.status, b); });
    });
    api("/me?c=" + encodeURIComponent(code)).then(function (g) {
      me = g;
      paintInvite();
      buttons.forEach(function (b) { b.disabled = false; });
      load();
    }).catch(function (err) {
      inviteTitle.textContent = "Link no válido";
      inviteText.textContent = err.status === 404
        ? "Este link no corresponde a ningún invitado. Pedile el tuyo al organizador."
        : "No pudimos cargar tu convocatoria. Recargá la página en un momento.";
      document.getElementById("invite-actions").hidden = true;
    });
  }

  initInvite();
  load();
  setInterval(function () { if (!document.hidden) load(); }, POLL_MS);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
})();
