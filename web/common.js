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
    not_placing: "Ahora no toca elegir casilla.",
    not_your_turn: "Cambió el turno. Mirá quién patea ahora.",
    invalid_zone: "Elegí un lugar del arco.",
    invalid_team: "Ese equipo no existe.",
    team_taken: "Ese equipo ya lo eligió otro. Elegí otro.",
    invalid_slot: "Esa casilla no existe.",
    slot_taken: "Esa casilla ya está ocupada. Elegí otra.",
    slot_needed: "No se puede sacar: hacen falta todas las casillas para los que quedan.",
    not_in_line: "Ese jugador ya no está en la fila.",
    draw_not_finished: "Todavía falta gente por elegir equipo en el sorteo.",
    empty_slots: "Hay casillas vacías en el fixture: sacalas en el sorteo.",
    groups_already_built: "La liga ya está armada.",
    tournament_started: "El torneo ya arrancó: el sorteo está cerrado.",
    invalid_player_count: "Hacen falta entre 4 y 16 jugadores con equipo.",
    knockout_started: "La llave ya arrancó: los resultados de la liga quedan fijos.",
    pen_winner_required: "Empate en la llave: elegí quién ganó por penales.",
    invalid_score: "Resultado inválido.",
    match_not_ready: "Ese cruce todavía no está definido."
  };
  function errorText(err) { return ERRORS[err && err.code] || "Algo falló. Probá de nuevo."; }

  /**
   * Fixture en zigzag: las casillas en dos filas (1, 3, 5… arriba; 2, 4, 6… abajo) y una línea por partido
   * entre cada casilla y la siguiente; la última vuelve a la primera con una flecha. Así cada casilla tiene
   * sus dos líneas salientes, una a cada rival.
   *   nodes: [{ label, person, team, free, mine, onClick, onRemove }]
   *   edges: (opcional) un texto por partido: edges[i] es el de la casilla i contra la i+1 (la última contra la 1ª)
   *   highlight: (opcional) índice de casilla a resaltar con sus dos partidos
   * Al pasar por una casilla libre que se puede tocar, se iluminan sus dos líneas.
   */
  function zigzag(opts) {
    var nodes = opts.nodes, n = nodes.length;
    // En pantallas angostas va vertical: dos columnas (1, 3, 5… a la izquierda) que bajan en zigzag.
    var vertical = opts.vertical != null ? opts.vertical : window.innerWidth < 640;
    var NODE_W = 92, NODE_H = 84, STEP = vertical ? 78 : 88, PAD = 46, W, H, cx, cy;
    if (vertical) {
      var LEFT = 26 + NODE_W / 2, RIGHT = LEFT + NODE_W + 70;
      W = RIGHT + NODE_W / 2 + 26;
      H = PAD + NODE_H + Math.max(0, n - 1) * STEP + 20;
      cx = function (i) { return i % 2 === 0 ? LEFT : RIGHT; };
      cy = function (i) { return PAD / 2 + NODE_H / 2 + i * STEP; };
    } else {
      var TOP_Y = 74, BOT_Y = 196;
      W = PAD * 2 + NODE_W + Math.max(0, n - 1) * STEP;
      H = 272;
      cx = function (i) { return PAD + NODE_W / 2 + i * STEP; };
      cy = function (i) { return i % 2 === 0 ? TOP_Y : BOT_Y; };
    }

    var scroll = el("div", "zz-scroll" + (vertical ? " zz-vertical" : ""));
    var box = el("div", "zz");
    box.style.width = W + "px";
    box.style.height = H + "px";
    scroll.appendChild(box);

    var SVGNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "zz-lines");
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("aria-hidden", "true");
    box.appendChild(svg);

    var edgeEls = [], labelEls = [];
    function addEdge(i, d, lx, ly) {
      var path = document.createElementNS(SVGNS, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "zz-edge" + (i === n - 1 && n > 2 ? " zz-wrap" : ""));
      svg.appendChild(path);
      edgeEls[i] = path;
      var text = opts.edges && opts.edges[i];
      var lab = el("span", "zz-label" + (text && text.cls ? " " + text.cls : ""), text ? text.text : "vs");
      lab.style.left = lx + "px";
      lab.style.top = ly + "px";
      box.appendChild(lab);
      labelEls[i] = lab;
    }
    if (n >= 2) {
      for (var i = 0; i < n - 1; i++) {
        addEdge(i, "M" + cx(i) + " " + cy(i) + " L" + cx(i + 1) + " " + cy(i + 1),
          (cx(i) + cx(i + 1)) / 2, (cy(i) + cy(i + 1)) / 2);
      }
      if (n > 2) {
        // La vuelta: de la última a la primera, por afuera, con una flecha.
        var last = n - 1, same = last % 2 === 0, d, lx, ly, ax, ay;
        if (vertical) {
          // Por el costado: la izquierda si la última está a la izquierda; si no, por la derecha y arriba.
          var xSide = same ? 10 : W - 10;
          var xFrom = same ? cx(last) - NODE_W / 2 : cx(last) + NODE_W / 2;
          if (same) d = "M" + xFrom + " " + cy(last) + " H" + xSide + " V" + cy(0) + " H" + (cx(0) - NODE_W / 2);
          else d = "M" + xFrom + " " + cy(last) + " H" + xSide + " V" + 8 + " H" + cx(0) + " V" + (cy(0) - NODE_H / 2);
          lx = xSide; ly = (cy(0) + cy(last)) / 2; ax = xSide; ay = cy(0) + STEP / 2;
        } else {
          // Por arriba si la última está arriba; si no, por abajo.
          var yEdge = same ? 12 : H - 12, xBack = PAD - 26;
          var yLast = same ? cy(last) - NODE_H / 2 : cy(last) + NODE_H / 2;
          d = "M" + cx(last) + " " + yLast + " V" + yEdge + " H" + xBack + " V" + cy(0) + " H" + (cx(0) - NODE_W / 2);
          lx = (cx(last) + xBack) / 2; ly = yEdge; ax = xBack; ay = same ? cy(0) / 2 : (cy(0) + H) / 2;
        }
        addEdge(last, d, lx, ly);
        var arrow = el("span", "zz-arrow", "↺");
        arrow.style.left = ax + "px";
        arrow.style.top = ay + "px";
        box.appendChild(arrow);
      }
    }

    function light(i, on) {
      if (i == null || n < 2) return;
      var prev = (i - 1 + n) % n;
      [i, prev].forEach(function (e) {
        if (edgeEls[e]) edgeEls[e].classList.toggle("lit", on);
        if (labelEls[e]) labelEls[e].classList.toggle("lit", on);
      });
      [prev, (i + 1) % n].forEach(function (j) { if (nodeEls[j] && j !== i) nodeEls[j].classList.toggle("rival", on); });
    }

    var nodeEls = nodes.map(function (nd, i) {
      var node = el(nd.onClick ? "button" : "div", "zz-node" + (nd.free ? " free" : " taken") + (nd.mine ? " mine" : "") + (nd.onClick ? " pickable" : ""));
      if (nd.onClick) {
        node.type = "button";
        node.addEventListener("click", nd.onClick);
        node.addEventListener("mouseenter", function () { light(i, true); });
        node.addEventListener("mouseleave", function () { light(i, false); });
        node.addEventListener("focus", function () { light(i, true); });
        node.addEventListener("blur", function () { light(i, false); });
      }
      node.style.left = (cx(i) - NODE_W / 2) + "px";
      node.style.top = (cy(i) - NODE_H / 2) + "px";
      node.style.width = NODE_W + "px";
      node.style.height = NODE_H + "px";
      node.appendChild(el("span", "zz-num", nd.label));
      if (nd.person) {
        var face = el("span", "zz-face");
        face.appendChild(avatar(nd.person, "avatar-sm"));
        if (nd.team) face.appendChild(crest(nd.team, "sm"));
        node.appendChild(face);
        node.appendChild(el("b", "zz-name", nd.person.name));
      } else {
        node.appendChild(el("span", "zz-free", "?"));
        node.appendChild(el("b", "zz-name", "Libre"));
      }
      if (nd.onRemove) {
        var x = el("button", "zz-x", "✕");
        x.type = "button";
        x.title = "Sacar esta casilla";
        x.addEventListener("click", function (e) { e.stopPropagation(); nd.onRemove(); });
        node.appendChild(x);
      }
      box.appendChild(node);
      return node;
    });

    if (opts.highlight != null && opts.highlight >= 0) {
      nodeEls[opts.highlight].classList.add("hl");
      light(opts.highlight, true);
    }
    return scroll;
  }

  /**
   * Diálogo propio en lugar de confirm()/alert() del navegador. Devuelve una promesa con true si aceptó.
   *   opts: { title, text, media (nodo opcional, p. ej. un escudo), ok, cancel (false = solo aceptar), danger }
   */
  var askOpen = null;
  function ask(opts) {
    if (typeof opts === "string") opts = { text: opts };
    if (askOpen) askOpen(false);
    return new Promise(function (resolve) {
      var dlg = el("dialog", "ask-dialog" + (opts.danger ? " danger" : ""));
      dlg.setAttribute("aria-labelledby", "ask-title");
      if (opts.media) { var m = el("div", "ask-media"); m.appendChild(opts.media); dlg.appendChild(m); }
      dlg.appendChild(el("h3", null, opts.title || "¿Seguro?")).id = "ask-title";
      if (opts.text) dlg.appendChild(el("p", "ask-text", opts.text));
      var row = el("div", "ask-actions");
      var yes = el("button", "btn btn-yes btn-sm", opts.ok || "Sí");
      yes.type = "button";
      row.appendChild(yes);
      if (opts.cancel !== false) {
        var no = el("button", "btn btn-no btn-sm", opts.cancel || "Cancelar");
        no.type = "button";
        no.addEventListener("click", function () { done(false); });
        row.appendChild(no);
      }
      dlg.appendChild(row);
      var finished = false;
      function done(v) {
        if (finished) return;
        finished = true;
        askOpen = null;
        if (dlg.open) dlg.close();
        dlg.remove();
        resolve(v);
      }
      askOpen = done;
      yes.addEventListener("click", function () { done(true); });
      dlg.addEventListener("cancel", function (e) { e.preventDefault(); done(opts.cancel === false); });
      dlg.addEventListener("click", function (e) { if (e.target === dlg) done(opts.cancel === false); });
      document.body.appendChild(dlg);
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
      (opts.danger && no ? no : yes).focus();
    });
  }
  function notice(text, title) { return ask({ title: title || "Ojo", text: text, ok: "Entendido", cancel: false }); }

  window.Supremo = {
    zigzag: zigzag, ask: ask, notice: notice,
    api: api, adminPost: adminPost, getToken: function () { return memToken; }, setToken: setToken,
    adminGate: adminGate, el: el, crest: crest, avatar: avatar, errorText: errorText,
    pollMs: 4000
  };
})();
