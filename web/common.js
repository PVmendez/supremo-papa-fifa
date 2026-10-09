// Utilidades compartidas por /sorteo y /torneo: llamadas a la API, token de admin y escudos.
(function () {
  "use strict";

  var cfg = window.APP_CONFIG || {};
  var API = cfg.apiBase || "/api";
  var TOKEN_KEY = "supremo-admin-token";

  function api(path, opts) {
    return fetch(API + path, Object.assign({ headers: { "content-type": "application/json" } }, opts || {}))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok) { var err = new Error(body.error || ("HTTP " + r.status)); err.status = r.status; err.code = body.error; throw err; }
          return body;
        });
      });
  }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function setToken(t) {
    try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* sin storage: queda en memoria */ }
    memToken = t || "";
  }
  var memToken = getToken();

  function adminPost(path, body) {
    return api(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": memToken },
      body: JSON.stringify(body || {})
    });
  }

  /**
   * Acceso del organizador, igual en /sorteo y /torneo: un botón visible abre un campo para el código;
   * se valida contra la API y queda guardado en ese dispositivo hasta tocar "Salir".
   * onChange(true|false) avisa a la página cuándo mostrar o esconder los controles.
   */
  function adminGate(onChange) {
    var open = document.getElementById("admin-open");
    var panel = document.getElementById("admin");
    var form = document.getElementById("token-form");
    var input = document.getElementById("token");
    var actions = document.getElementById("admin-actions");
    var logout = document.getElementById("admin-logout");
    var msg = document.getElementById("admin-msg");

    function show(state) {   // "closed" | "asking" | "on"
      open.hidden = state !== "closed";
      panel.hidden = state === "closed";
      form.hidden = state !== "asking";
      actions.hidden = state !== "on";
      logout.hidden = state === "closed";
      onChange(state === "on");
    }

    open.addEventListener("click", function () { show("asking"); input.focus(); });
    logout.addEventListener("click", function () {
      setToken("");
      input.value = "";
      msg.textContent = "";
      show("closed");
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var t = input.value.trim();
      if (!t) return;
      var btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      msg.textContent = "Verificando…";
      api("/admin/check", { method: "POST", headers: { "content-type": "application/json", "x-admin-token": t } })
        .then(function () {
          setToken(t);
          input.value = "";
          msg.textContent = "";
          show("on");
        })
        .catch(function (err) {
          msg.textContent = err.status === 401 ? "Código incorrecto." : "No se pudo verificar. Probá de nuevo.";
        })
        .then(function () { btn.disabled = false; });
    });

    show(memToken ? "on" : "closed");
    return {
      /** La API rechazó el código guardado (por ejemplo, porque se cambió): se vuelve a pedir. */
      invalid: function () { setToken(""); show("asking"); msg.textContent = "El código guardado ya no sirve. Ingresalo de nuevo."; }
    };
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** Escudo del club (con la sigla en sus colores como respaldo si la imagen no carga). */
  function crest(team, size) {
    var c = el("span", "crest" + (size ? " crest-" + size : ""));
    c.setAttribute("aria-hidden", "true");
    if (!team) { c.textContent = "?"; return c; }
    c.title = team.name;
    c.style.setProperty("--c1", team.colors[0]);
    c.style.setProperty("--c2", team.colors[1]);
    var fallback = function () { c.classList.add("crest-text"); c.textContent = team.id.toUpperCase(); };
    if (!team.logo) { fallback(); return c; }
    var img = document.createElement("img");
    img.src = team.logo; img.alt = "";
    img.onerror = fallback;
    c.appendChild(img);
    return c;
  }

  /** Foto chica del jugador (o sus iniciales si todavía no tiene ilustración). */
  function avatar(p, cls) {
    var a = el("span", "avatar" + (cls ? " " + cls : ""));
    if (p && p.photo) {
      var img = document.createElement("img");
      img.src = p.photo; img.alt = ""; img.loading = "lazy";
      a.appendChild(img);
    } else {
      a.textContent = p && p.name ? p.name.charAt(0) : "?";
    }
    return a;
  }

  var ERRORS = {
    unauthorized: "Código del organizador incorrecto.",
    nobody_waiting: "No hay confirmados sin equipo para el sorteo.",
    already_started: "El sorteo ya arrancó.",
    must_pick: "Primero tiene que elegir equipo el que hizo el gol.",
    not_shooting: "Ahora no hay nadie para patear.",
    not_picking: "Ahora no toca elegir equipo.",
    not_your_turn: "Cambió el turno. Mirá quién patea ahora.",
    invalid_zone: "Elegí un lugar del arco.",
    invalid_team: "Ese equipo no existe.",
    team_taken: "Ese equipo ya lo eligió otro. Elegí otro.",
    groups_already_built: "El torneo ya está armado.",
    tournament_started: "El torneo ya arrancó: el sorteo está cerrado.",
    invalid_player_count: "Hacen falta entre 4 y 16 jugadores con equipo.",
    knockout_started: "La llave ya arrancó: los resultados de grupos quedan fijos.",
    pen_winner_required: "Empate en la llave: elegí quién ganó por penales.",
    invalid_score: "Resultado inválido.",
    match_not_ready: "Ese cruce todavía no está definido."
  };
  function errorText(err) { return ERRORS[err && err.code] || "Algo falló. Probá de nuevo."; }

  window.Supremo = {
    api: api, adminPost: adminPost, getToken: function () { return memToken; }, setToken: setToken,
    adminGate: adminGate, el: el, crest: crest, avatar: avatar, errorText: errorText,
    pollMs: 4000
  };
})();
