// Animaciones del sitio, sobre GSAP.
// - popConfetti: port a JS plano del componente "Party Popper" de 21st.dev (@pulkitxm):
//   ráfaga de partículas y serpentinas con física simple, en la paleta del póster.
// - flipReveal: giro 3D de la card (incógnito -> revelada), con la curva power3.inOut
//   y el fallback sin movimiento del "GSAP Card Flip" de 21st.dev (@hyperiux).
// Todo respeta prefers-reduced-motion: sin GSAP o con movimiento reducido, los cambios son instantáneos.
(function () {
  "use strict";

  var gsap = window.gsap;
  var COLORS = ["#D4AF37", "#F1D27A", "#9B2335", "#1E3A5F", "#EDE3CC", "#ffffff"];
  var reduced = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  function canAnimate() { return !!gsap && !reduced.matches; }
  function rand(min, max) { return Math.random() * (max - min) + min; }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  var layer = null;
  function getLayer() {
    if (layer && document.body.contains(layer)) return layer;
    layer = document.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden";
    document.body.appendChild(layer);
    return layer;
  }

  var DIRECTIONS = {
    center: { center: 0, spread: 180, streamerCenter: 315, streamerSpread: 25 },
    up: { center: 270, spread: 60, streamerCenter: 270, streamerSpread: 40 }
  };

  function piece(x, y, w, h, color, round) {
    var p = document.createElement("div");
    p.style.cssText = "position:absolute;left:" + x + "px;top:" + y + "px;width:" + w + "px;height:" + h +
      "px;background:" + color + ";border-radius:" + round + ";transform:translate(-50%,-50%)";
    getLayer().appendChild(p);
    return p;
  }

  /** Ráfaga de confeti desde un elemento (o un punto {x, y} en la ventana). */
  function popConfetti(origin, opts) {
    if (!canAnimate()) return;
    opts = opts || {};
    var x, y;
    if (origin && origin.getBoundingClientRect) {
      var r = origin.getBoundingClientRect();
      x = r.left + r.width / 2; y = r.top + r.height / 2;
    } else { x = origin.x; y = origin.y; }

    var dir = DIRECTIONS[opts.direction || "center"];
    var particles = opts.particles || 28;
    var streamers = opts.streamers || 8;

    for (var i = 0; i < particles; i++) {
      var size = rand(7, 13);
      var p = piece(x, y, size, size, pick(COLORS), i % 3 === 0 ? "0" : "50%");
      var a = (dir.center + rand(-dir.spread, dir.spread)) * Math.PI / 180;
      var v = rand(220, 420), d = rand(1.5, 2.5);
      gsap.timeline({ onComplete: p.remove.bind(p) })
        .to(p, { duration: d * 0.6, ease: "power2.out", rotation: rand(-360, 360), x: Math.cos(a) * v * d * 0.8, y: Math.sin(a) * v * d * 0.8 })
        .to(p, { duration: 1, ease: "power1.in", rotation: "+=" + rand(-180, 180), y: "+=" + rand(100, 200) }, "-=0.2")
        .to(p, { duration: 0.8, ease: "power2.out", opacity: 0 }, "-=0.6");
    }

    for (var j = 0; j < streamers; j++) {
      var s = piece(x, y, rand(25, 38), rand(4, 6), pick(COLORS), "2px");
      var b = (dir.streamerCenter + rand(-dir.streamerSpread, dir.streamerSpread)) * Math.PI / 180;
      var w = rand(450, 560);
      gsap.timeline({ onComplete: s.remove.bind(s) })
        .to(s, { duration: 1, ease: "power2.out", rotation: rand(-360, 360), x: Math.cos(b) * w, y: Math.sin(b) * w })
        .to(s, { duration: 1.2, ease: "power2.in", rotation: "+=" + rand(-180, 180), y: "+=250" }, "-=0.1")
        .to(s, { duration: 1, ease: "power2.out", opacity: 0 }, "-=0.8");
    }
  }

  /** Golpe del sello CONFIRMADO / RECHAZADO sobre la card. */
  function slamStamp(card) {
    var stamp = card.querySelector(".stamp");
    if (!stamp || !canAnimate()) return;
    gsap.fromTo(stamp,
      { scale: 2.6, rotation: -22, opacity: 0 },
      { scale: 1, rotation: -6, opacity: 1, duration: 0.45, ease: "back.out(2.2)", delay: 0.05,
        onComplete: function () { gsap.fromTo(card, { y: 0 }, { y: 3, duration: 0.06, yoyo: true, repeat: 1 }); } });
  }

  /**
   * Gira la card de incógnito a revelada: la vieja gira hasta el canto (90°),
   * se reemplaza por la nueva y la nueva termina el giro. Después, sello y efecto según el estado.
   */
  function flipReveal(oldCard, newCard, status) {
    if (!canAnimate()) { oldCard.replaceWith(newCard); return; }
    var parent = oldCard.parentNode;
    if (parent) parent.style.perspective = "1400px";
    gsap.timeline()
      .to(oldCard, { rotationY: 90, scale: 1.06, duration: 0.35, ease: "power3.in" })
      .add(function () {
        oldCard.replaceWith(newCard);
        gsap.set(newCard, { rotationY: -90, scale: 1.06 });
      })
      .to(newCard, { rotationY: 0, scale: 1, duration: 0.55, ease: "power3.out", clearProps: "transform",
        onComplete: function () {
          slamStamp(newCard);
          if (status === "yes") {
            setTimeout(function () { popConfetti(newCard, { particles: 24, streamers: 6 }); }, 180);
          } else if (status === "no") {
            gsap.fromTo(newCard, { x: 0 }, { x: 8, duration: 0.06, yoyo: true, repeat: 5, ease: "none", clearProps: "x", delay: 0.35 });
          }
        } });
  }

  /** Entrada inicial: las cards caen escalonadas como recortes pegados. */
  function dealCards(cards) {
    if (!canAnimate() || !cards.length) return;
    gsap.from(cards, { y: 40, opacity: 0, rotation: function () { return rand(-8, 8); },
      duration: 0.6, ease: "back.out(1.6)", stagger: 0.045, clearProps: "transform,opacity" });
  }

  /** Contador que rueda hasta el nuevo valor. */
  function countTo(el, from, to, format) {
    if (!canAnimate() || from === to) { el.textContent = format(to); return; }
    var obj = { v: from };
    gsap.to(obj, { v: to, duration: 0.8, ease: "power2.out",
      onUpdate: function () { el.textContent = format(Math.round(obj.v)); } });
    gsap.fromTo(el, { scale: 1 }, { scale: 1.12, duration: 0.18, yoyo: true, repeat: 1, ease: "power2.out" });
  }

  /** Pulso del botón al tocarlo. */
  function press(btn) {
    if (!canAnimate()) return;
    gsap.fromTo(btn, { scale: 1 }, { scale: 0.92, duration: 0.09, yoyo: true, repeat: 1, ease: "power2.out" });
  }

  window.Effects = { popConfetti: popConfetti, flipReveal: flipReveal, slamStamp: slamStamp, dealCards: dealCards, countTo: countTo, press: press };
})();
