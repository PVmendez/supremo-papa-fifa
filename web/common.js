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

  /** El panel de admin aparece si ya hay token guardado o si la URL trae ?admin. */
  function wantsAdmin() {
    if (memToken) return true;
    try { return new URLSearchParams(window.location.search).has("admin"); } catch (e) { return false; }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** Escudo genérico: los dos colores del club y su sigla. */
  function crest(team, size) {
    var c = el("span", "crest" + (size ? " crest-" + size : ""), team ? team.id.toUpperCase() : "?");
    if (team) {
      c.style.setProperty("--c1", team.colors[0]);
      c.style.setProperty("--c2", team.colors[1]);
      c.title = team.name;
    }
    c.setAttribute("aria-hidden", "true");
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
    unauthorized: "Token de admin incorrecto.",
    nobody_waiting: "No queda nadie confirmado sin equipo.",
    no_teams_left: "No quedan sobres.",
    no_steals_left: "Ese jugador ya no tiene robos.",
    team_locked: "Ese equipo ya fue robado: tiene candado.",
    both_need_team: "Los dos tienen que tener equipo.",
    same_player: "Elegí dos jugadores distintos.",
    tournament_started: "El torneo ya arrancó: el sorteo está cerrado.",
    already_started: "El torneo ya está armado.",
    invalid_player_count: "Hacen falta entre 4 y 16 jugadores con equipo.",
    knockout_started: "La llave ya arrancó: los resultados de grupos quedan fijos.",
    pen_winner_required: "Empate en la llave: elegí quién ganó por penales.",
    invalid_score: "Resultado inválido.",
    match_not_ready: "Ese cruce todavía no está definido."
  };
  function errorText(err) { return ERRORS[err && err.code] || "Algo falló. Probá de nuevo."; }

  window.Supremo = {
    api: api, adminPost: adminPost, getToken: function () { return memToken; }, setToken: setToken,
    wantsAdmin: wantsAdmin, el: el, crest: crest, avatar: avatar, errorText: errorText,
    pollMs: 4000
  };
})();
