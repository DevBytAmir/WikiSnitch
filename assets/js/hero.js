// The seal, the moon and the network of boxes in the hero. Plain JavaScript, no libraries.
// Ported from the app's SealMoon component. The moon turns through its phases by itself (unless the visitor
// prefers reduced motion); dragging, scrolling over it or the arrow keys turn it by hand. The boxes drift,
// can be dragged, and spring back. Colours come from the page's CSS (--ink and friends), so both themes work.
(function () {
  "use strict";

  var MOON_URL = "/assets/img/hero/moon.webp";

  // Stage layout. The seal fills the bottom; the band of PAD source pixels above it holds the moon.
  var SC = 1.5; // canvas pixels per source pixel
  var SEAL_W = 784;
  var SEAL_H = 716;
  var PAD = 250;
  var W = SEAL_W * SC;
  var H = (PAD + SEAL_H) * SC;
  var MOON = { x: 300 * SC, y: 134 * SC, r: 100.8 * SC };
  var MOON_SRC = { size: 272, r: 131.5 }; // the moon image, and the radius of the disc in it
  var MOON_PAPER = "#faf7ee";
  var TAU = Math.PI * 2;
  var CYCLE_SECONDS = 36 / 1.15; // one lunar cycle when turning by itself (about 31 s)
  var RESUME_AFTER_MS = 1000; // after the visitor lets go, the moon turns by itself again
  var START_ANGLE = -0.9; // rotation of the moon in radians; full moon at 0

  // The decorative network around the moon. Units: 1000 = stage width, from the stage's top-left corner.
  // `half` is half a box's side.
  var STAGE_UNITS_H = (1000 * H) / W;
  var WEB_POINTS = {
    moon: { x: (MOON.x / W) * 1000, y: (MOON.y / W) * 1000, half: ((MOON.r * 1.2) / W) * 1000 },
    // Few boxes, laid out to fit inside the art column (see #hero-moon in site.css): from about -150 on the left
    // to about 1230 on the right. A short chain down the left edge, and a branch off the moon to the right.
    b: { x: -70, y: 120, half: 50, label: "2.8571" },
    e: { x: -90, y: 560, half: 44, label: "0.5714" },
    g: { x: -60, y: 1040, half: 46, label: "2.4286" },
    h: { x: 780, y: 70, half: 40, label: "1.4286" },
    i: { x: 1130, y: 230, half: 34, label: "1.0000" },
    j: { x: 1120, y: 700, half: 46, label: "1.5714" },
    k: { x: 1060, y: 1100, half: 36, label: "1.7143" },
  };
  var WEB_EDGES = [
    ["b", "moon"], ["b", "e"], ["e", "g"],
    ["moon", "h"], ["h", "i"], ["h", "j"], ["j", "k"],
  ];

  var SVG_NS = "http://www.w3.org/2000/svg";

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function phaseOf(a) { return (((0.5 + a / TAU) % 1) + 1) % 1; } // 0 new, 0.5 full
  function illumination(p) { return (1 - Math.cos(TAU * p)) / 2; }
  function degrees(a) { return ((((a * 180) / Math.PI) % 360) + 360) % 360; }
  function litText(p) { return Math.round(illumination(p) * 100) + "% lit"; }

  function phaseName(p) {
    if (p < 0.03 || p > 0.97) return "New moon";
    if (p < 0.235) return "Waxing crescent";
    if (p < 0.265) return "First quarter";
    if (p < 0.47) return "Waxing gibbous";
    if (p < 0.53) return "Full moon";
    if (p < 0.735) return "Waning gibbous";
    if (p < 0.765) return "Last quarter";
    return "Waning crescent";
  }

  // Outline of the dark side in moon-local coordinates. The terminator stays in screen space (light comes
  // from the side); only the face rotates.
  function shadowPath(c, p, r) {
    var cos = Math.cos(TAU * p);
    var n = 72;
    var left = [];
    var right = [];
    for (var i = 0; i <= n; i++) {
      var y = -r + (2 * r * i) / n;
      var s = Math.sqrt(Math.max(0, r * r - y * y));
      if (p < 0.5) {
        left.push([-s, y]); // waxing: dark on the left
        right.push([cos * s, y]);
      } else {
        left.push([-cos * s, y]); // waning: dark on the right
        right.push([s, y]);
      }
    }
    c.beginPath();
    c.moveTo(left[0][0], left[0][1]);
    for (var a = 0; a < left.length; a++) c.lineTo(left[a][0], left[a][1]);
    for (var b = right.length - 1; b >= 0; b--) c.lineTo(right[b][0], right[b][1]);
    c.closePath();
  }

  function canvas2d(w, h) {
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var g = c.getContext("2d");
    return g ? [c, g] : null;
  }

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ---------------------------------------------------------------------------------------------- the moon

  function initMoon(canvas, nameEl, litEl, hintEl) {
    var turnsByItself = !reducedMotion();
    var resumeAt = 0; // while the visitor is turning the moon, it does not also turn by itself
    var angle = START_ANGLE;
    var velocity = 0;
    var dragging = false;
    var dragMode = "angular";
    var lastPointerAngle = 0;
    var lastX = 0;
    var lastT = 0;
    var visible = true;
    var raf = 0;

    function touched() {
      if (hintEl) hintEl.hidden = true;
      resumeAt = performance.now() + RESUME_AFTER_MS;
    }

    function toCanvas(e) {
      var b = canvas.getBoundingClientRect();
      return { x: ((e.clientX - b.left) * W) / b.width, y: ((e.clientY - b.top) * H) / b.height };
    }
    function onMoon(pt) {
      return Math.hypot(pt.x - MOON.x, pt.y - MOON.y) < MOON.r * 1.2;
    }

    canvas.addEventListener("pointerdown", function (e) {
      var pt = toCanvas(e);
      if (!onMoon(pt)) return;
      touched();
      dragging = true;
      velocity = 0;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
      dragMode = Math.hypot(pt.x - MOON.x, pt.y - MOON.y) > MOON.r * 0.3 ? "angular" : "linear";
      lastPointerAngle = Math.atan2(pt.y - MOON.y, pt.x - MOON.x);
      lastX = pt.x;
      lastT = performance.now();
    });
    canvas.addEventListener("pointermove", function (e) {
      var pt = toCanvas(e);
      if (!dragging) {
        canvas.style.cursor = onMoon(pt) ? "grab" : "";
        return;
      }
      var now = performance.now();
      var delta;
      if (dragMode === "angular") {
        var a = Math.atan2(pt.y - MOON.y, pt.x - MOON.x);
        delta = a - lastPointerAngle;
        if (delta > Math.PI) delta -= TAU;
        if (delta < -Math.PI) delta += TAU;
        lastPointerAngle = a;
      } else {
        delta = (pt.x - lastX) / MOON.r;
        lastX = pt.x;
      }
      angle += delta;
      var dt = Math.max(1, now - lastT) / 1000;
      velocity = 0.7 * velocity + 0.3 * (delta / dt);
      lastT = now;
    });
    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      resumeAt = performance.now() + RESUME_AFTER_MS;
      canvas.style.cursor = "grab";
      if (performance.now() - lastT > 80) velocity = 0; // let go after pausing: no fling
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (err) {
        // The capture is already gone.
      }
    }
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    // A touch that starts on the moon turns it; anywhere else it scrolls the page as usual.
    canvas.addEventListener(
      "touchstart",
      function (e) {
        var t = e.touches[0];
        if (t && onMoon(toCanvas(t))) e.preventDefault();
      },
      { passive: false }
    );
    canvas.addEventListener(
      "wheel",
      function (e) {
        if (!onMoon(toCanvas(e))) return;
        e.preventDefault();
        touched();
        angle += (e.deltaY + e.deltaX) * 0.0025;
      },
      { passive: false }
    );
    canvas.addEventListener("keydown", function (e) {
      var step = ((e.shiftKey ? 30 : 5) * Math.PI) / 180;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") angle += step;
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") angle -= step;
      else return;
      e.preventDefault();
      touched();
    });

    // Off screen, the moon keeps turning but is not drawn.
    if (typeof IntersectionObserver !== "undefined") {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
      }).observe(canvas);
    }

    // Drawing starts once the moon image has loaded.
    var moonImg = new Image();

    function start() {
      var ctx = canvas.getContext("2d");
      var shade = canvas2d(Math.ceil(MOON.r * 2 + 24), Math.ceil(MOON.r * 2 + 24));
      var hatchTile = canvas2d(8, 8);
      if (!ctx || !shade || !hatchTile) return;
      var shadeCanvas = shade[0];
      var sctx = shade[1];
      var S = shadeCanvas.width;

      // engraved hatch for the dark side
      var tile = hatchTile[0];
      var h = hatchTile[1];
      h.strokeStyle = "rgba(15,18,15,0.55)";
      h.lineWidth = 1;
      h.beginPath();
      for (var i = -8; i <= 16; i += 8) {
        h.moveTo(i, 8);
        h.lineTo(i + 8, 0);
      }
      h.stroke();
      var hatch = ctx.createPattern(tile, "repeat");

      var style = getComputedStyle(canvas);
      var ink = "";
      var drawnAngle = NaN;

      function draw(c) {
        var p = phaseOf(angle);
        var lit = illumination(p);
        var x = MOON.x;
        var y = MOON.y;
        var r = MOON.r;

        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalCompositeOperation = "source-over";
        c.globalAlpha = 1;
        c.clearRect(0, 0, W, H);

        // dashed orbit ring
        c.save();
        c.strokeStyle = ink;
        c.lineWidth = 2.6;
        c.setLineDash([16, 11]);
        c.beginPath();
        c.arc(x, y, r * 1.2, 0, TAU);
        c.stroke();
        c.restore();

        // soft moonlight glow, stronger as the moon fills
        var glow = c.createRadialGradient(x, y, r * 0.9, x, y, r * 1.16);
        glow.addColorStop(0, "rgba(255,255,252," + 0.95 * lit + ")");
        glow.addColorStop(1, "rgba(255,255,252,0)");
        c.fillStyle = glow;
        c.beginPath();
        c.arc(x, y, r * 1.16, 0, TAU);
        c.fill();

        // the moon itself, rotated
        c.save();
        c.beginPath();
        c.arc(x, y, r + 1.5, 0, TAU);
        c.clip();
        c.fillStyle = MOON_PAPER;
        c.fill();
        c.translate(x, y);
        c.rotate(angle);
        var s = MOON_SRC.size * (r / MOON_SRC.r);
        c.drawImage(moonImg, -s / 2, -s / 2, s, s);
        c.restore();

        // soft-edged dark side, then engraved hatching over it
        if (lit < 0.999) {
          var half = S / 2;
          sctx.setTransform(1, 0, 0, 1, 0, 0);
          sctx.clearRect(0, 0, S, S);
          sctx.filter = "blur(3.5px)";
          sctx.translate(half, half);
          shadowPath(sctx, p, r + 2);
          sctx.fillStyle = "#343934";
          sctx.fill();
          sctx.filter = "none";

          c.save();
          c.beginPath();
          c.arc(x, y, r + 1.5, 0, TAU);
          c.clip();
          c.globalCompositeOperation = "multiply";
          c.globalAlpha = 0.88;
          c.drawImage(shadeCanvas, x - half, y - half);
          c.globalAlpha = 1;
          c.globalCompositeOperation = "source-over";
          c.translate(x, y);
          shadowPath(c, p, r + 2);
          c.clip();
          if (hatch) {
            c.fillStyle = hatch;
            c.globalAlpha = 0.55;
            c.fillRect(-r - 4, -r - 4, 2 * r + 8, 2 * r + 8);
          }
          c.restore();
        }

        // crisp rim
        c.globalAlpha = 1;
        c.globalCompositeOperation = "source-over";
        c.strokeStyle = ink;
        c.lineWidth = 3;
        c.beginPath();
        c.arc(x, y, r, 0, TAU);
        c.stroke();
      }

      function label() {
        var p = phaseOf(angle);
        var name = phaseName(p);
        var lit = litText(p);
        if (nameEl.textContent !== name) nameEl.textContent = name;
        if (litEl.textContent !== lit) litEl.textContent = lit;
        canvas.setAttribute("aria-valuenow", String(Math.round(degrees(angle))));
        canvas.setAttribute("aria-valuetext", name + ", " + lit);
      }

      var prev = 0;
      function frame(now) {
        var dt = Math.min(0.05, (now - prev) / 1000);
        prev = now;
        if (!dragging) {
          if (Math.abs(velocity) > 0.01) {
            angle += velocity * dt;
            velocity *= Math.pow(0.04, dt); // friction
          } else velocity = 0;
          if (turnsByItself && now >= resumeAt) angle += (TAU / CYCLE_SECONDS) * dt;
        }
        if (visible) {
          // The theme sets the ink of the rings: redraw when it changes.
          if (style.color !== ink) {
            ink = style.color;
            drawnAngle = NaN;
          }
          if (angle !== drawnAngle) {
            draw(ctx);
            label();
            drawnAngle = angle;
          }
        }
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(function (t) {
        prev = t;
        frame(t);
      });
    }

    moonImg.onload = start;
    moonImg.src = MOON_URL;
  }

  // ----------------------------------------------------------------------------------------- the boxes

  // Where a line from p towards q leaves p: the edge of p's box, or the moon's orbit ring.
  function exitPoint(p, q) {
    var dx = q.x - p.x;
    var dy = q.y - p.y;
    var t = p.label === undefined ? p.half / Math.hypot(dx, dy) : p.half / Math.max(Math.abs(dx), Math.abs(dy));
    return [p.x + dx * t, p.y + dy * t];
  }

  // Springs for the network, in stage units and seconds. Each box is held to its place by an anchor spring and
  // to its neighbours by the lines; boxes pushed closer than they rest repel each other. The moon never moves.
  var K_ANCHOR = 60;
  var K_EDGE = 50;
  var K_REPEL = 80;
  var REPEL_RANGE = 200;
  var MAX_FLING = 3000;
  // Three boxes move on their own, each on its own loop and at its own pace; every other box only reacts, pulled
  // by the lines. Amplitudes in stage units (2.5 = 1px), periods in seconds, phases in radians.
  var WEB_MOVERS = {
    b: { ax: 22, ay: 38, period: 12, phase: 0 },
    g: { ax: 18, ay: 40, period: 9, phase: 1 },
    j: { ax: 32, ay: 70, period: 19, phase: 4 },
  };
  var READOUT_MS = 120; // numbers update at most this often while floating, so they read calmly

  function buildWeb() {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "seal-moon-web");
    svg.setAttribute("viewBox", "0 0 1000 " + STAGE_UNITS_H);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    WEB_EDGES.forEach(function (edge) {
      var p = WEB_POINTS[edge[0]];
      var q = WEB_POINTS[edge[1]];
      var a = exitPoint(p, q);
      var b = exitPoint(q, p);
      var line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("data-edge", "");
      line.setAttribute("x1", a[0]);
      line.setAttribute("y1", a[1]);
      line.setAttribute("x2", b[0]);
      line.setAttribute("y2", b[1]);
      svg.appendChild(line);
    });
    Object.keys(WEB_POINTS).forEach(function (key) {
      var p = WEB_POINTS[key];
      if (p.label === undefined) return;
      var g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("data-node", key);
      g.setAttribute("transform", "translate(" + p.x + " " + p.y + ")");
      var rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", -p.half);
      rect.setAttribute("y", -p.half);
      rect.setAttribute("width", 2 * p.half);
      rect.setAttribute("height", 2 * p.half);
      var text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", 0);
      text.setAttribute("y", 0);
      text.textContent = p.label;
      g.appendChild(rect);
      g.appendChild(text);
      svg.appendChild(g);
    });
    return svg;
  }

  // Numbered boxes joined by dashed lines through the moon. Three boxes move on their own and the rest react
  // through the lines. A box can be dragged: the boxes joined to it follow, nearby ones are pushed aside, each
  // number follows its box's distance to the moon, and on release everything springs back.
  function initWeb(svg) {
    var nodes = Object.keys(WEB_POINTS).map(function (id) {
      var p = WEB_POINTS[id];
      return {
        id: id, x: p.x, y: p.y, half: p.half, label: p.label,
        hx: p.x, hy: p.y, rx: p.x, ry: p.y, vx: 0, vy: 0, fx: 0, fy: 0,
      };
    });
    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });
    var drifters = nodes.filter(function (n) { return WEB_MOVERS[n.id]; }).map(function (n) {
      var m = WEB_MOVERS[n.id];
      return { n: n, ax: m.ax, ay: m.ay, period: m.period, phase: m.phase };
    });
    // No drift for visitors who prefer reduced motion, nor while the network is off screen.
    var drifts = !reducedMotion() && drifters.length > 0;
    var hasObserver = typeof IntersectionObserver !== "undefined";
    var visible = !hasObserver;

    var groups = {};
    Array.prototype.forEach.call(svg.querySelectorAll("g[data-node]"), function (g) {
      groups[g.getAttribute("data-node")] = g;
    });
    var lines = Array.prototype.slice.call(svg.querySelectorAll("line[data-edge]"));

    // A box's number scales with its distance to the moon: its base value at home, more when farther.
    var moon = byId.moon;
    var readouts = [];
    nodes.forEach(function (n) {
      var g = groups[n.id];
      var text = g && g.querySelector("text") && g.querySelector("text").firstChild;
      if (moon && n.label !== undefined && text) {
        readouts.push({ n: n, text: text, value: parseFloat(n.label), home: Math.hypot(n.rx - moon.rx, n.ry - moon.ry) });
      }
    });
    var edges = [];
    WEB_EDGES.forEach(function (e, k) {
      var p = byId[e[0]];
      var q = byId[e[1]];
      var line = lines[k];
      if (p && q && line) edges.push({ p: p, q: q, el: line, len: Math.hypot(q.rx - p.rx, q.ry - p.ry) });
    });
    var pairs = [];
    nodes.forEach(function (p, i) {
      nodes.slice(i + 1).forEach(function (q) {
        pairs.push({ p: p, q: q, near: Math.min(REPEL_RANGE, 0.9 * Math.hypot(q.rx - p.rx, q.ry - p.ry)) });
      });
    });
    function fixed(n) { return n.label === undefined; }
    // Bouncy by default; without the bounce for visitors who prefer reduced motion.
    var damping = 2 * (reducedMotion() ? 1 : 0.75) * Math.sqrt(K_ANCHOR);

    var drag = null;
    var raf = 0;
    var last = 0;
    var lastReadout = 0;

    function step(dt) {
      var i, n, e, d, dx, dy, f;
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        n.fx = -K_ANCHOR * (n.x - n.rx) - damping * n.vx;
        n.fy = -K_ANCHOR * (n.y - n.ry) - damping * n.vy;
      }
      for (i = 0; i < edges.length; i++) {
        e = edges[i];
        dx = e.q.x - e.p.x;
        dy = e.q.y - e.p.y;
        d = Math.hypot(dx, dy) || 1;
        f = (K_EDGE * (d - e.len)) / d;
        e.p.fx += f * dx;
        e.p.fy += f * dy;
        e.q.fx -= f * dx;
        e.q.fy -= f * dy;
      }
      for (i = 0; i < pairs.length; i++) {
        var pr = pairs[i];
        dx = pr.q.x - pr.p.x;
        dy = pr.q.y - pr.p.y;
        d = Math.hypot(dx, dy) || 1;
        if (d >= pr.near) continue;
        f = (K_REPEL * (pr.near - d)) / d;
        pr.p.fx -= f * dx;
        pr.p.fy -= f * dy;
        pr.q.fx += f * dx;
        pr.q.fy += f * dy;
      }
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        if (fixed(n) || (drag && n === drag.node)) continue;
        n.vx += n.fx * dt;
        n.vy += n.fy * dt;
        n.x += n.vx * dt;
        n.y += n.vy * dt;
      }
    }

    function render(final) {
      var i;
      for (i = 0; i < nodes.length; i++) {
        var g = groups[nodes[i].id];
        if (g) g.setAttribute("transform", "translate(" + nodes[i].x + " " + nodes[i].y + ")");
      }
      for (i = 0; i < edges.length; i++) {
        var e = edges[i];
        var a = exitPoint(e.p, e.q);
        var b = exitPoint(e.q, e.p);
        e.el.setAttribute("x1", String(a[0]));
        e.el.setAttribute("y1", String(a[1]));
        e.el.setAttribute("x2", String(b[0]));
        e.el.setAttribute("y2", String(b[1]));
      }
      var now = performance.now();
      if (moon && (final || now - lastReadout >= READOUT_MS)) {
        lastReadout = now;
        for (i = 0; i < readouts.length; i++) {
          var r = readouts[i];
          var shown = ((r.value * Math.hypot(r.n.x - moon.x, r.n.y - moon.y)) / r.home).toFixed(4);
          if (r.text.nodeValue !== shown) r.text.nodeValue = shown;
        }
      }
    }

    // Within half a pixel of home and barely moving (2.5 units = 1px).
    function settled() {
      return nodes.every(function (n) {
        return Math.abs(n.x - n.rx) < 1 && Math.abs(n.y - n.ry) < 1 && Math.hypot(n.vx, n.vy) < 5;
      });
    }

    function tick(now) {
      var dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      var drifting = drifts && visible;
      if (drifting) {
        // Two slow waves per axis at unrelated rates, so no path repeats like clockwork.
        drifters.forEach(function (d) {
          var w = (TAU * now) / 1000 / d.period + d.phase;
          d.n.rx = d.n.hx + d.ax * (0.8 * Math.sin(w) + 0.2 * Math.sin(2.3 * w + 1.1));
          d.n.ry = d.n.hy + d.ay * (0.8 * Math.sin(0.77 * w + 1) + 0.2 * Math.sin(1.9 * w + 2.4));
        });
      }
      for (var i = 0; i < 4; i++) step(dt / 4);
      if (!drag && !drifting && settled()) {
        nodes.forEach(function (n) {
          n.x = n.rx;
          n.y = n.ry;
          n.vx = n.vy = 0;
        });
        render(true);
        raf = 0;
        return;
      }
      render(false);
      raf = requestAnimationFrame(tick);
    }
    function wake() {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }

    function toUnits(e) {
      var b = svg.getBoundingClientRect();
      return { x: ((e.clientX - b.left) * 1000) / b.width, y: ((e.clientY - b.top) * STAGE_UNITS_H) / b.height };
    }
    svg.addEventListener("pointerdown", function (e) {
      var target = e.target instanceof Element ? e.target : null;
      var group = target && target.closest("g[data-node]");
      var node = group && byId[group.getAttribute("data-node")];
      if (!target || !group || !node || drag) return;
      var pt = toUnits(e);
      drag = { node: node, pointerId: e.pointerId, dx: node.x - pt.x, dy: node.y - pt.y, vx: 0, vy: 0, t: performance.now() };
      node.vx = node.vy = 0;
      target.setPointerCapture(e.pointerId);
      group.setAttribute("data-active", "");
      e.preventDefault();
      wake();
    });
    svg.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      var node = drag.node;
      var pt = toUnits(e);
      var now = performance.now();
      var dt = Math.max(1, now - drag.t) / 1000;
      var x = pt.x + drag.dx;
      var y = pt.y + drag.dy;
      drag.vx = 0.7 * drag.vx + (0.3 * (x - node.x)) / dt;
      drag.vy = 0.7 * drag.vy + (0.3 * (y - node.y)) / dt;
      drag.t = now;
      node.x = x;
      node.y = y;
      wake();
    });
    function onUp(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      var node = drag.node;
      var speed = Math.hypot(drag.vx, drag.vy);
      var scale = speed > MAX_FLING ? MAX_FLING / speed : 1;
      node.vx = drag.vx * scale;
      node.vy = drag.vy * scale;
      if (groups[node.id]) groups[node.id].removeAttribute("data-active");
      drag = null;
      wake();
    }
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);

    if (hasObserver) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible && drifts) wake();
      }).observe(svg);
    } else if (drifts) {
      wake();
    }

    return { nodes: nodes, step: step, render: render, tick: tick };
  }

  // ------------------------------------------------------------------------------------------ the page

  function mount(host) {
    var p0 = phaseOf(START_ANGLE);

    var root = el("div", "seal-moon");
    var stage = el("div", "seal-moon-stage");
    var seal = el("span", "seal-moon-seal");
    seal.setAttribute("aria-hidden", "true");

    var canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "slider");
    canvas.setAttribute("aria-label", "Moon. Drag, scroll or use the arrow keys to turn it and change its phase.");
    canvas.setAttribute("aria-valuemin", "0");
    canvas.setAttribute("aria-valuemax", "360");
    canvas.setAttribute("aria-valuenow", String(Math.round(degrees(START_ANGLE))));
    canvas.setAttribute("aria-valuetext", phaseName(p0) + ", " + litText(p0));

    var web = buildWeb();
    stage.appendChild(seal);
    stage.appendChild(canvas);
    stage.appendChild(web);

    var phase = el("div", "seal-moon-phase");
    var nameEl = el("div", "seal-moon-name", phaseName(p0));
    var litRow = el("div", "seal-moon-lit");
    var litEl = el("span", "", litText(p0));
    var hint = el("span", "", " · drag the moon to turn it");
    litRow.appendChild(litEl);
    litRow.appendChild(hint);
    phase.appendChild(nameEl);
    phase.appendChild(litRow);

    root.appendChild(stage);
    root.appendChild(phase);
    host.appendChild(root);

    initMoon(canvas, nameEl, litEl, hint);
    return initWeb(web);
  }

  function boot() {
    var host = document.getElementById("hero-moon");
    if (host) window.__heroMoon = mount(host);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
