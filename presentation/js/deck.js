/* WikiSnitch slides: navigation, scaling, theme, and the hero's moon and network.
   Plain script (no modules) so the deck also works when opened straight from disk.

   URL options:  #3        open on slide 3
                 ?render   still frames for build.mjs (no animation, no controls)
                 ?print    open the print dialog, to save as PDF from the browser
                 ?theme=dark|light                                                  */
(function () {
  "use strict";

  var W = 1920;
  var H = 1080;
  var TAU = Math.PI * 2;
  var params = new URLSearchParams(location.search);
  var RENDER = params.has("render");
  var PRINT = params.has("print");
  var EMBEDDED = window.parent !== window;
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var STILL = RENDER || PRINT || reduced;

  var root = document.documentElement;
  var viewport = document.querySelector(".viewport");
  var deck = document.getElementById("deck");
  var slides = Array.prototype.slice.call(deck.querySelectorAll(".slide"));
  var N = slides.length;
  var controls = document.getElementById("controls");
  var counter = document.getElementById("counter");
  var progress = document.getElementById("progress");
  var prevBtn = document.getElementById("prev");
  var nextBtn = document.getElementById("next");
  var themeBtn = document.getElementById("theme");
  var fsBtn = document.getElementById("fs");

  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // ---------- Chrome for every slide: the app's top bar, a footer with credit and page number ----------

  slides.forEach(function (s, i) {
    var head = el("header", "s-head");
    var brand = el("div", "brand");
    var mark = el("span", "brand-mark");
    var img = el("img");
    img.src = "assets/seal-mark.png";
    img.alt = "";
    mark.appendChild(img);
    var text = el("span", "brand-text");
    text.appendChild(el("span", "brand-name", "WikiSnitch"));
    text.appendChild(el("span", "brand-tag", "Wikipedia, with a memory"));
    brand.appendChild(mark);
    brand.appendChild(text);
    var label = el("div", "s-label");
    label.appendChild(el("span", "s-label-n", pad(i + 1)));
    label.appendChild(document.createTextNode(s.getAttribute("data-label") || ""));
    head.appendChild(brand);
    head.appendChild(label);
    s.insertBefore(head, s.firstChild);

    var foot = el("footer", "s-foot");
    foot.appendChild(s.querySelector(".s-credit") || el("span"));
    foot.appendChild(el("span", "s-num", pad(i + 1) + " / " + pad(N)));
    s.appendChild(foot);

    s.setAttribute("role", "group");
    s.setAttribute("aria-roledescription", "slide");
    s.setAttribute("aria-label", i + 1 + " of " + N + ": " + s.getAttribute("data-title"));
  });

  // ---------- Fit the 1920×1080 canvas to the window ----------

  function fit() {
    var s = Math.min(window.innerWidth / W, window.innerHeight / H);
    deck.style.transform = "translate(-50%, -50%) scale(" + s + ")";
  }
  if (!PRINT) {
    fit();
    window.addEventListener("resize", fit);
  }

  // ---------- Talking to the page that embeds the deck (index.html) ----------

  function post(msg) {
    if (!EMBEDDED) return;
    msg.source = "wikisnitch-deck";
    try {
      window.parent.postMessage(msg, "*");
    } catch (e) {}
  }

  // ---------- Navigation ----------

  var cur = -1;
  function go(i) {
    i = Math.max(0, Math.min(N - 1, i | 0));
    if (i === cur) return;
    if (cur >= 0) {
      slides[cur].classList.remove("active");
      if (demos[cur]) demos[cur].finish();
    }
    cur = i;
    slides[cur].classList.add("active");
    if (demos[cur]) {
      if (STILL) demos[cur].finish();
      else demos[cur].play();
    }
    counter.textContent = cur + 1 + " / " + N;
    progress.style.width = ((cur + 1) / N) * 100 + "%";
    prevBtn.disabled = cur === 0;
    nextBtn.disabled = cur === N - 1;
    if (!RENDER && !PRINT) {
      try {
        history.replaceState(null, "", "#" + (cur + 1));
      } catch (e) {}
    }
    document.title = "WikiSnitch · " + slides[cur].getAttribute("data-title");
    post({ type: "slide", index: cur });
    wake();
  }
  function fromHash() {
    var n = parseInt(location.hash.slice(1), 10);
    return isNaN(n) ? 0 : n - 1;
  }

  prevBtn.addEventListener("click", function () { go(cur - 1); });
  nextBtn.addEventListener("click", function () { go(cur + 1); });
  window.addEventListener("hashchange", function () { go(fromHash()); });

  document.addEventListener("keydown", function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t && t.closest && t.closest("button, a") && (e.key === " " || e.key === "Enter")) return;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
      case "PageDown":
      case "Enter":
        go(cur + 1);
        break;
      case " ":
        go(e.shiftKey ? cur - 1 : cur + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp":
      case "Backspace":
        go(cur - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(N - 1);
        break;
      case "f":
      case "F":
        toggleFullscreen();
        break;
      case "d":
      case "D":
        setTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark", true);
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  // Click: the left third goes back, the rest goes forward. Links and buttons keep their own clicks.
  viewport.addEventListener("click", function (e) {
    if (e.target.closest("a, button")) return;
    go(e.clientX < window.innerWidth / 3 ? cur - 1 : cur + 1);
  });

  // Swipe on touch screens.
  var touchX = null;
  viewport.addEventListener("touchstart", function (e) { touchX = e.touches[0].clientX; }, { passive: true });
  viewport.addEventListener("touchend", function (e) {
    if (touchX === null) return;
    var dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? cur + 1 : cur - 1);
  });

  // ---------- Full screen and theme ----------

  function toggleFullscreen() {
    var d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    } else {
      var req = root.requestFullscreen || root.webkitRequestFullscreen;
      if (req) {
        var p = req.call(root);
        if (p && p.catch) p.catch(function () { post({ type: "fullscreen" }); });
      } else {
        post({ type: "fullscreen" });
      }
    }
  }
  fsBtn.addEventListener("click", toggleFullscreen);

  function setTheme(t, fromHere) {
    if (t === "dark") root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
    themeBtn.querySelector("use").setAttribute("href", t === "dark" ? "#i-sun" : "#i-moon");
    if (fromHere) {
      try {
        localStorage.setItem("wikisnitch-theme", t);
      } catch (e) {}
      post({ type: "theme", theme: t });
    }
  }
  setTheme(root.getAttribute("data-theme") === "dark" ? "dark" : "light", false);
  themeBtn.addEventListener("click", function () {
    setTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark", true);
  });

  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || m.source !== "wikisnitch-site") return;
    if (m.type === "go") go(m.index);
    else if (m.type === "next") go(cur + 1);
    else if (m.type === "prev") go(cur - 1);
    else if (m.type === "theme") setTheme(m.theme, false);
    else if (m.type === "hello") sendReady();
  });

  function sendReady() {
    post({
      type: "ready",
      index: cur,
      theme: root.getAttribute("data-theme") === "dark" ? "dark" : "light",
      titles: slides.map(function (s) { return s.getAttribute("data-title"); }),
    });
  }

  // Controls show while the pointer moves, then fade; the cursor hides with them.
  var idleTimer = 0;
  function poke() {
    controls.classList.add("show");
    viewport.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      controls.classList.remove("show");
      viewport.classList.add("idle");
    }, 2200);
  }
  document.addEventListener("mousemove", poke);
  if (!EMBEDDED && !RENDER) poke();

  // ---------- The moon: phases as on the app's home page (SealMoon.tsx) ----------

  var START_ANGLE = -0.9; // waxing gibbous, 81% lit
  var CYCLE_SECONDS = 36 / 1.15;
  var angle = START_ANGLE;
  var phaseOf = function (a) { return (((0.5 + a / TAU) % 1) + 1) % 1; };
  var illumination = function (p) { return (1 - Math.cos(TAU * p)) / 2; };
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
  /** The dark side, in moon units (radius r), as an SVG path. Light comes from the side; only the face turns. */
  function shadowPath(p, r) {
    var c = Math.cos(TAU * p);
    var n = 48;
    var left = [];
    var right = [];
    for (var i = 0; i <= n; i++) {
      var y = -r + (2 * r * i) / n;
      var s = Math.sqrt(Math.max(0, r * r - y * y));
      if (p < 0.5) {
        left.push([-s, y]);
        right.push([c * s, y]);
      } else {
        left.push([-c * s, y]);
        right.push([s, y]);
      }
    }
    var pts = left.concat(right.reverse());
    return "M" + pts.map(function (q) { return q[0].toFixed(2) + " " + q[1].toFixed(2); }).join("L") + "Z";
  }

  var moons = Array.prototype.slice.call(document.querySelectorAll("svg[data-moon]")).map(function (svg, k) {
    var id = "moon" + k;
    svg.innerHTML =
      "<defs>" +
      '<clipPath id="' + id + 'c"><circle r="101"/></clipPath>' +
      '<pattern id="' + id + 'h" width="5.4" height="5.4" patternUnits="userSpaceOnUse"><path d="M-5.4 5.4L0 0M0 5.4L5.4 0M5.4 5.4L10.8 0" stroke="rgba(15,18,15,0.55)" stroke-width="0.7"/></pattern>' +
      '<filter id="' + id + 'b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.3"/></filter>' +
      '<radialGradient id="' + id + 'g" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="116"><stop offset="0.776" stop-color="#fffffc" stop-opacity="0.95"/><stop offset="1" stop-color="#fffffc" stop-opacity="0"/></radialGradient>' +
      "</defs>" +
      '<circle r="120" fill="none" stroke="currentColor" stroke-width="1.7" stroke-dasharray="10.6 7.3"/>' +
      '<circle class="moon-glow" r="116" fill="url(#' + id + 'g)"/>' +
      '<g clip-path="url(#' + id + 'c)">' +
      '<circle r="101" fill="#faf7ee"/>' +
      '<image class="moon-face" href="assets/moon.webp" x="-103.4" y="-103.4" width="206.8" height="206.8"/>' +
      '<path class="moon-soft" fill="#343934" opacity="0.88" filter="url(#' + id + 'b)" style="mix-blend-mode:multiply"/>' +
      '<path class="moon-hatch" fill="url(#' + id + 'h)" opacity="0.55"/>' +
      "</g>" +
      '<circle r="100" fill="none" stroke="currentColor" stroke-width="2"/>';
    var box = svg.closest(".seal-moon");
    return {
      slide: svg.closest(".slide"),
      face: svg.querySelector(".moon-face"),
      soft: svg.querySelector(".moon-soft"),
      hatch: svg.querySelector(".moon-hatch"),
      glow: svg.querySelector(".moon-glow"),
      name: box && box.querySelector("[data-phase-name]"),
      lit: box && box.querySelector("[data-phase-lit]"),
    };
  });

  function drawMoons() {
    var p = phaseOf(angle);
    var lit = illumination(p);
    var d = lit < 0.999 ? shadowPath(p, 102) : "";
    var deg = ((angle * 180) / Math.PI).toFixed(2);
    moons.forEach(function (m) {
      m.face.setAttribute("transform", "rotate(" + deg + ")");
      m.soft.setAttribute("d", d);
      m.hatch.setAttribute("d", d);
      m.glow.setAttribute("opacity", lit.toFixed(3));
      if (m.name) {
        var nm = phaseName(p);
        if (m.name.textContent !== nm) m.name.textContent = nm;
        var lt = Math.round(lit * 100) + "% lit";
        if (m.lit.textContent !== lt) m.lit.textContent = lt;
      }
    });
  }

  // ---------- The hero's network: numbered boxes on dashed lines through the moon ----------

  var NS = "http://www.w3.org/2000/svg";
  var web = document.querySelector("svg.web");
  var net = null;
  if (web) {
    var mc = web.getAttribute("data-center").split(" ").map(Number);
    // x, y and half a side in slide pixels; the labels are the app's.
    var POINTS = {
      moon: [mc[0], mc[1], mc[2]],
      a: [640, 150, 20, "2.2857"],
      b: [935, 172, 30, "2.8571"],
      c: [1150, 232, 21, "1.5714"],
      d: [1072, 352, 17, "1.0000"],
      e: [1010, 505, 25, "0.5714"],
      f: [1060, 735, 20, "0.7143"],
      g: [1050, 958, 27, "2.4286"],
      h: [1590, 205, 22, "1.4286"],
      i: [1815, 140, 18, "1.0000"],
      j: [1815, 520, 25, "1.5714"],
      k: [1790, 850, 20, "1.7143"],
    };
    var EDGES = [["a", "b"], ["b", "c"], ["c", "moon"], ["c", "d"], ["d", "e"], ["e", "f"], ["f", "g"], ["moon", "h"], ["h", "i"], ["h", "j"], ["j", "k"]];
    // Four boxes drift on their own loops, as in the app; amplitudes in slide pixels, periods in seconds.
    var MOVERS = {
      g: { ax: 48, ay: 27, period: 6.5, phase: 1 },
      b: { ax: 60, ay: 33, period: 10, phase: 0 },
      e: { ax: 33, ay: 57, period: 15, phase: 2 },
      j: { ax: 45, ay: 69, period: 21, phase: 4 },
    };
    var nodes = {};
    Object.keys(POINTS).forEach(function (k) {
      var p = POINTS[k];
      nodes[k] = { id: k, hx: p[0], hy: p[1], x: p[0], y: p[1], half: p[2], label: p[3] };
    });
    var moonNode = nodes.moon;
    var exitPoint = function (p, q) {
      var dx = q.x - p.x;
      var dy = q.y - p.y;
      var t = p.label === undefined ? p.half / Math.hypot(dx, dy) : p.half / Math.max(Math.abs(dx), Math.abs(dy));
      return [p.x + dx * t, p.y + dy * t];
    };
    var lines = EDGES.map(function (e) {
      var l = document.createElementNS(NS, "line");
      web.appendChild(l);
      return { p: nodes[e[0]], q: nodes[e[1]], el: l };
    });
    Object.keys(nodes).forEach(function (k) {
      var n = nodes[k];
      if (n.label === undefined) return;
      var g = document.createElementNS(NS, "g");
      var r = document.createElementNS(NS, "rect");
      r.setAttribute("x", -n.half);
      r.setAttribute("y", -n.half);
      r.setAttribute("width", 2 * n.half);
      r.setAttribute("height", 2 * n.half);
      var t = document.createElementNS(NS, "text");
      t.textContent = n.label;
      g.appendChild(r);
      g.appendChild(t);
      web.appendChild(g);
      n.g = g;
      n.text = t;
      n.value = parseFloat(n.label);
      n.home = Math.hypot(n.hx - moonNode.x, n.hy - moonNode.y);
    });
    net = {
      slide: web.closest(".slide"),
      lastReadout: 0,
      draw: function (now, moving) {
        if (moving) {
          Object.keys(MOVERS).forEach(function (k) {
            var m = MOVERS[k];
            var n = nodes[k];
            var w = (TAU * now) / 1000 / m.period + m.phase;
            n.x = n.hx + m.ax * (0.8 * Math.sin(w) + 0.2 * Math.sin(2.3 * w + 1.1));
            n.y = n.hy + m.ay * (0.8 * Math.sin(0.77 * w + 1) + 0.2 * Math.sin(1.9 * w + 2.4));
          });
        }
        Object.keys(nodes).forEach(function (k) {
          var n = nodes[k];
          if (n.g) n.g.setAttribute("transform", "translate(" + n.x.toFixed(1) + " " + n.y.toFixed(1) + ")");
        });
        lines.forEach(function (l) {
          var a = exitPoint(l.p, l.q);
          var b = exitPoint(l.q, l.p);
          l.el.setAttribute("x1", a[0].toFixed(1));
          l.el.setAttribute("y1", a[1].toFixed(1));
          l.el.setAttribute("x2", b[0].toFixed(1));
          l.el.setAttribute("y2", b[1].toFixed(1));
        });
        // Each number follows its box's distance to the moon, updated calmly.
        if (!moving || now - this.lastReadout > 120) {
          this.lastReadout = now;
          Object.keys(MOVERS).forEach(function (k) {
            var n = nodes[k];
            n.text.textContent = ((n.value * Math.hypot(n.x - moonNode.x, n.y - moonNode.y)) / n.home).toFixed(4);
          });
        }
      },
    };
  }

  // ---------- The workflow slide: three of the app's components acting out their step ----------
  // Each runs in turn when the slide opens: the article list re-sorts by "Most edited", the time machine
  // plays from 2004 to today, and a question is asked. All numbers are real (see the slide's data-*).

  function workflowDemo(slide) {
    var cards = slide.querySelectorAll(".wf-step");
    var al = slide.querySelector(".al");
    var tm = slide.querySelector(".tm");
    var ak = slide.querySelector(".ak");
    var frames = JSON.parse(tm.getAttribute("data-frames"));
    var cum = JSON.parse(tm.getAttribute("data-cum"));
    var months = +tm.getAttribute("data-n");
    var CW = 480;
    var colW = CW / (months + 1);
    var clip = tm.querySelector(".tm-clip");
    var head = tm.querySelector(".tm-head");
    var date = tm.querySelector(".tm-date");
    var versions = tm.querySelector(".tm-versions");
    var words = tm.querySelector(".tm-words");
    var paras = tm.querySelector(".tm-paras");
    var mix = tm.querySelectorAll(".tm-mix span");
    var counts = [0, 1, 2, 3].map(function (j) { return tm.querySelector(".tm-c" + j); });
    var typed = ak.querySelector(".ak-typed");
    var question = ak.querySelector(".ak-q").getAttribute("data-text");
    var askSteps = ak.querySelectorAll(".ak-steps li");
    var timers = [];
    var sweepRaf = 0;
    var fmtN = function (n) { return n.toLocaleString("en-US"); };

    function active(n) {
      Array.prototype.forEach.call(cards, function (c, k) { c.classList.toggle("is-active", k === n - 1); });
    }
    function frame(k) {
      var fr = frames[k];
      date.textContent = fr[1];
      words.textContent = fmtN(fr[2]);
      paras.textContent = fmtN(fr[3]);
      for (var j = 0; j < 4; j++) {
        mix[j].style.flexGrow = fr[4 + j];
        counts[j].textContent = fr[4 + j];
      }
    }
    function playhead(i) {
      var x = Math.min(CW, (i + 0.78) * colW).toFixed(1);
      clip.setAttribute("width", x);
      head.setAttribute("x1", x);
      head.setAttribute("x2", x);
      versions.textContent = fmtN(cum[Math.max(0, Math.min(months - 1, Math.floor(i)))]);
    }
    function ticks(n) {
      Array.prototype.forEach.call(askSteps, function (li, k) { li.classList.toggle("on", k < n); });
    }
    function clear() {
      timers.forEach(clearTimeout);
      timers = [];
      cancelAnimationFrame(sweepRaf);
      sweepRaf = 0;
    }
    function at(ms, fn) { timers.push(setTimeout(fn, ms)); }

    function finish() {
      clear();
      active(0);
      al.className = "al sorted picked";
      tm.classList.remove("playing");
      frame(frames.length - 1);
      playhead(months);
      typed.textContent = question;
      ak.className = "ak answered";
      ticks(askSteps.length);
    }
    function sweep(duration) {
      var start = frames[0][0];
      var t0 = performance.now();
      var k = 0;
      (function step(now) {
        var p = Math.min(1, (now - t0) / duration);
        var i = start + (months - start) * p;
        playhead(i);
        while (k + 1 < frames.length && frames[k + 1][0] <= i) frame(++k);
        if (p < 1) sweepRaf = requestAnimationFrame(step);
        else tm.classList.remove("playing");
      })(t0);
    }
    function play() {
      clear();
      active(0);
      al.className = "al";
      tm.classList.remove("playing");
      frame(0);
      playhead(frames[0][0]);
      typed.textContent = "";
      ak.className = "ak";
      ticks(0);

      at(300, function () { active(1); });
      at(1000, function () { al.classList.add("pressing"); });
      at(1150, function () { al.classList.remove("pressing"); al.classList.add("sorted"); });
      at(2200, function () { al.classList.add("picked"); });

      at(3000, function () { active(2); tm.classList.add("playing"); sweep(5200); });

      var t = 8800;
      at(t, function () { active(3); ak.classList.add("typing"); });
      for (var c = 1; c <= question.length; c++) {
        (function (n) { at(t + 200 + n * 50, function () { typed.textContent = question.slice(0, n); }); })(c);
      }
      t += 200 + question.length * 50 + 300;
      at(t, function () { ak.classList.add("pressing"); });
      at(t + 150, function () { ak.classList.remove("pressing", "typing"); });
      for (var s = 1; s <= askSteps.length; s++) {
        (function (n) { at(t + 300 + n * 320, function () { ticks(n); }); })(s);
      }
      at(t + 450 + askSteps.length * 320, function () { ak.classList.add("answered"); });
      at(t + 1800 + askSteps.length * 320, function () { active(0); });
    }
    return { play: play, finish: finish };
  }

  // ---------- The pipeline slide: the load runs step by step, then one question goes there and back ----------

  function pipelineDemo(slide) {
    var pipe = slide.querySelector(".pipe");
    var steps = pipe.querySelectorAll("li");
    var counters = pipe.querySelectorAll("[data-to]");
    var run = slide.querySelector(".run");
    var boxes = { web: run.querySelector(".run-web"), api: run.querySelector(".run-api"), db: run.querySelector(".run-db") };
    var pkts = run.querySelectorAll(".pkt");
    var models = run.querySelectorAll(".run-m");
    var timers = [];
    var countRaf = 0;
    var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };
    var fmtN = function (n) { return n.toLocaleString("en-US"); };

    function at(ms, fn) { timers.push(setTimeout(fn, ms)); }
    function clear() {
      timers.forEach(clearTimeout);
      timers = [];
      cancelAnimationFrame(countRaf);
      countRaf = 0;
      each(pkts, function (p) { if (p.getAnimations) p.getAnimations().forEach(function (a) { a.cancel(); }); });
    }
    function count(el, ms) {
      var to = +el.getAttribute("data-to");
      var t0 = performance.now();
      (function tick(now) {
        var p = Math.min(1, (now - t0) / ms);
        el.textContent = fmtN(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) countRaf = requestAnimationFrame(tick);
      })(t0);
    }
    // Step n is running, the ones before it are done; n = steps.length means all done.
    function step(n) {
      each(steps, function (li, k) {
        li.classList.toggle("done", k < n);
        li.classList.toggle("on", k === n);
      });
      var c = steps[n] && steps[n].querySelector("[data-to]");
      if (c) count(c, 700);
    }
    function light(name) {
      Object.keys(boxes).forEach(function (k) { boxes[k].classList.toggle("on", k === name); });
    }
    function send(i, back) {
      if (!pkts[i].animate) return;
      var a = back ? "100%" : "0%";
      var b = back ? "0%" : "100%";
      pkts[i].animate(
        [{ left: a, opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { left: b, opacity: 0 }],
        { duration: 500, easing: "ease-in-out" }
      );
    }

    function finish() {
      clear();
      pipe.classList.remove("live");
      run.classList.remove("live");
      step(steps.length);
      each(counters, function (c) { c.textContent = fmtN(+c.getAttribute("data-to")); });
      light(null);
      each(models, function (m) { m.classList.add("lit"); });
    }
    function play() {
      clear();
      // Back to the start without animating the way there.
      slide.classList.add("instant");
      pipe.classList.add("live");
      run.classList.add("live");
      step(-1);
      each(counters, function (c) { c.textContent = "0"; });
      light(null);
      each(models, function (m) { m.classList.remove("lit"); });
      void slide.offsetWidth;
      slide.classList.remove("instant");

      var T = 850;
      var t = 500;
      for (var n = 0; n <= steps.length; n++) {
        (function (n) { at(t + n * T, function () { step(n); }); })(n);
      }
      t += steps.length * T + 400;
      at(t, function () { light("web"); });
      at(t + 300, function () { send(0, false); });
      at(t + 800, function () { light("api"); models[0].classList.add("lit"); });
      at(t + 1300, function () { send(1, false); });
      at(t + 1800, function () { light("db"); });
      at(t + 2500, function () { send(1, true); });
      at(t + 3000, function () { light("api"); models[1].classList.add("lit"); });
      at(t + 3500, function () { send(0, true); });
      at(t + 4000, function () { light("web"); });
      at(t + 5200, function () { finish(); });
    }
    return { play: play, finish: finish };
  }

  // ---------- The time machine slide: the whole history plays, then two dates are compared ----------
  // The chart and the month-by-month figures are real (Suomen sisällissota, from the API; see data-frames:
  // versions so far, words, the day the version in effect was saved). Month 0 is Aug 2003.

  function timeMachineDemo(slide) {
    var tmx = slide.querySelector(".tmx");
    var N = +tmx.getAttribute("data-n");
    var A = +tmx.getAttribute("data-a");
    var W = +tmx.getAttribute("data-w");
    var PL = +tmx.getAttribute("data-pl");
    var PR = +tmx.getAttribute("data-pr");
    var frames = JSON.parse(tmx.getAttribute("data-frames"));
    var clip = slide.querySelector("#tmx-clip rect");
    var tclip = slide.querySelector("#tmx-tclip rect");
    var band = slide.querySelector(".tmx-band");
    var phA = slide.querySelector(".ph-a");
    var phB = slide.querySelector(".ph-b");
    var textB = phB.querySelector("text");
    var date = slide.querySelector(".tmx-read .tmx-date");
    var saved = slide.querySelector(".tmx-saved");
    var versions = slide.querySelector(".tmx-versions");
    var words = slide.querySelector(".tmx-words");
    var pins = slide.querySelectorAll(".pin");
    var cards = slide.querySelectorAll(".tmx-moments li");
    var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var timers = [];
    var raf = 0;
    var shown = -1;
    var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };
    var fmtN = function (n) { return n.toLocaleString("en-US"); };
    var x = function (m) { return PL + (m / N) * (W - PL - PR); };
    var year = function (i) { return 2003 + Math.floor((i + 7) / 12); };

    function later(ms, fn) { timers.push(setTimeout(fn, ms)); }
    function clear() {
      timers.forEach(clearTimeout);
      timers = [];
      cancelAnimationFrame(raf);
      raf = 0;
    }
    function tween(ms, fn, done) {
      var t0 = performance.now();
      (function step(now) {
        var p = Math.min(1, (now - t0) / ms);
        fn(p);
        if (p < 1) raf = requestAnimationFrame(step);
        else if (done) done();
      })(t0);
    }
    // A playhead at month m; its label stays inside the chart.
    function place(ph, m) {
      var px = x(m);
      ph.setAttribute("transform", "translate(" + px.toFixed(1) + " 0)");
      var dx = Math.max(60, Math.min(W - 60, px)) - px;
      ph.querySelector(".ph-label").setAttribute("transform", "translate(" + dx.toFixed(1) + " 0)");
    }
    function fill(lo, hi) {
      clip.setAttribute("x", x(lo).toFixed(1));
      clip.setAttribute("width", Math.max(0, x(hi) - x(lo)).toFixed(1));
    }
    // Read mode, the playhead at month p (0 to N).
    function readAt(p) {
      p = Math.max(0, Math.min(N, p));
      place(phB, p);
      fill(0, p);
      tclip.setAttribute("width", x(p).toFixed(1));
      var i = Math.min(N - 1, Math.floor(p));
      if (i !== shown) {
        shown = i;
        var f = frames[i];
        textB.textContent = MON[(i + 7) % 12] + " " + year(i);
        date.textContent = new Date(Date.UTC(year(i), ((i + 7) % 12) + 1, 0)).getUTCDate() + " " + MON[(i + 7) % 12] + " " + year(i);
        saved.textContent = f[2];
        versions.textContent = fmtN(f[0]);
        words.textContent = fmtN(f[1]);
      }
      var now = -1;
      each(pins, function (el) { el.classList.toggle("future", +el.getAttribute("data-m") > p); });
      each(cards, function (el, k) {
        var past = +el.getAttribute("data-m") <= p;
        el.classList.toggle("future", !past);
        if (past) now = k;
      });
      each(cards, function (el, k) { el.classList.toggle("now", k === now); });
    }
    // Compare mode: B on the snapshot, A at month a.
    function compareAt(a) {
      place(phA, a);
      fill(a, N);
      band.setAttribute("x", x(a).toFixed(1));
      band.setAttribute("width", (x(N) - x(a)).toFixed(1));
      each(pins, function (el) { el.classList.toggle("future", +el.getAttribute("data-m") < a); });
    }
    function toCompare() {
      tmx.classList.add("cmp");
      textB.textContent = "B · Oct 2026";
      place(phB, N);
      tclip.setAttribute("width", W);
    }

    function finish() {
      clear();
      shown = -1;
      readAt(N);
      each(cards, function (el) { el.classList.remove("now"); });
      tmx.className = "tmx card cmp result";
      toCompare();
      compareAt(A);
    }
    function play() {
      clear();
      slide.classList.add("instant");
      tmx.className = "tmx card";
      shown = -1;
      readAt(0);
      compareAt(0);
      readAt(0);
      void slide.offsetWidth;
      slide.classList.remove("instant");

      later(700, function () { tmx.classList.add("pressing"); });
      later(850, function () {
        tmx.classList.remove("pressing");
        tmx.classList.add("playing");
        tween(9000, function (p) { readAt(p * N); }, function () { tmx.classList.remove("playing"); });
      });
      later(10600, function () { tmx.classList.add("pressing-cmp"); });
      later(10750, function () {
        tmx.classList.remove("pressing-cmp");
        toCompare();
        compareAt(0);
        tween(1200, function (p) { compareAt(A * (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2)); });
      });
      later(12300, function () { tmx.classList.add("result"); });
    }
    return { play: play, finish: finish };
  }

  // ---------- The languages slide: the meaning matches, then the numbers are compared ----------
  // A real pair (Suomen sisällissota and Finnish Civil War, from the API): same claim at 0.73, and the
  // ages of the flying patrols differ (13–14 in Finnish, 15 to 20 in English).

  function crossLangDemo(slide) {
    var box = slide.querySelector(".xlc");
    var sim = box.querySelector(".xlc-sim b");
    var to = parseFloat(sim.textContent);
    var timers = [];
    var raf = 0;

    function later(ms, fn) { timers.push(setTimeout(fn, ms)); }
    function clear() {
      timers.forEach(clearTimeout);
      timers = [];
      cancelAnimationFrame(raf);
      raf = 0;
    }
    function count(ms) {
      var t0 = performance.now();
      (function tick(now) {
        var p = Math.min(1, (now - t0) / ms);
        sim.textContent = (to * (1 - Math.pow(1 - p, 3))).toFixed(2);
        if (p < 1) raf = requestAnimationFrame(tick);
      })(t0);
    }
    function finish() {
      clear();
      box.className = "xlc card";
      sim.textContent = to.toFixed(2);
    }
    function play() {
      clear();
      slide.classList.add("instant");
      box.className = "xlc card live";
      sim.textContent = "0.00";
      void slide.offsetWidth;
      slide.classList.remove("instant");
      later(500, function () { box.classList.add("s1"); count(900); });
      later(1500, function () { box.classList.add("s2"); });
      later(2300, function () { box.classList.add("s3"); });
      later(3300, function () { box.classList.add("s4"); });
      later(4200, function () { box.classList.add("s5"); });
      later(5600, finish);
    }
    return { play: play, finish: finish };
  }

  // ---------- The Ask slide: two questions typed into the app's Ask page, which scrolls like a browser ----------
  // The answers, passages and similarities are what the API returned with the answer model on: 1967 gets
  // "No", 1943 gets "Yes", both cited to the same three paragraphs (see the slide's data-* attributes).

  function askDemo(slide) {
    var ap = slide.querySelector(".ap");
    var view = ap.querySelector(".ap-view");
    var page = ap.querySelector(".ap-page");
    var side = ap.querySelector(".ap-side");
    var form = ap.querySelector(".ap-form");
    var card = ap.querySelector(".ap-answer-card");
    var sources = ap.querySelector(".ap-sources");
    var typed = ap.querySelector(".ap-typed");
    var countN = ap.querySelector(".ap-count-n");
    var steps = ap.querySelectorAll(".ap-step");
    var bodies = ap.querySelectorAll(".ap-step-body");
    var fills = ap.querySelectorAll(".ap-meter-fill");
    var sims = ap.querySelectorAll(".ap-sim-n");
    var qs = [ap.getAttribute("data-q1"), ap.getAttribute("data-q2")];
    var SIDE_TOP = 152; // where the right rail starts, and where it sticks once the page scrolls
    var SIDE_STICK = 20;
    var timers = [];
    var raf = 0;
    var y = 0;
    var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };

    function later(ms, fn) { timers.push(setTimeout(fn, ms)); }
    function clear() {
      timers.forEach(clearTimeout);
      timers = [];
      cancelAnimationFrame(raf);
      raf = 0;
    }
    function offset(el) {
      var t = 0;
      for (; el && el !== page; el = el.offsetParent) t += el.offsetTop;
      return t;
    }
    function setY(v) {
      y = Math.max(0, Math.min(page.offsetHeight - view.clientHeight, v));
      page.style.transform = "translateY(" + (-y).toFixed(1) + "px)";
      side.style.transform = "translateY(" + Math.max(SIDE_STICK - SIDE_TOP, -y).toFixed(1) + "px)";
    }
    function scrollTo(target, ms) {
      cancelAnimationFrame(raf);
      var from = y;
      var t0 = performance.now();
      (function step(now) {
        var p = Math.min(1, (now - t0) / ms);
        setY(from + (target - from) * (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2));
        if (p < 1) raf = requestAnimationFrame(step);
      })(t0);
    }
    // Where the page rests: the question at the top, the answer below it.
    function restY() { return offset(form) - 12; }
    // Step n is running and the ones before it are done; n = 4 means answered, -1 not asked yet.
    function stepsAt(n, q) {
      each(steps, function (li, k) {
        li.classList.toggle("done", k < n || n === 4);
        li.classList.toggle("active", k === n);
      });
      each(bodies, function (b) { b.textContent = b.getAttribute(n === 4 ? "data-d" + q : "data-idle"); });
    }
    function showAnswer(q) {
      ap.setAttribute("data-q", q);
      each(fills, function (f) { f.style.width = f.getAttribute("data-w" + q) + "%"; });
      each(sims, function (s) { s.textContent = s.getAttribute("data-s" + q); });
    }
    function type(text, t0) {
      for (var i = 1; i <= text.length; i++) {
        (function (i) {
          later(t0 + i * 55, function () {
            typed.textContent = text.slice(0, i);
            countN.textContent = i;
            ap.classList.remove("empty");
          });
        })(i);
      }
      return t0 + text.length * 55;
    }
    function ask(q, t) {
      later(t, function () { ap.classList.add("pressing"); });
      later(t + 140, function () {
        ap.classList.remove("pressing", "typing");
        ap.classList.add("waiting");
        ap.setAttribute("data-asked", String(q));
        stepsAt(0, q);
        scrollTo(offset(form) - 12, 700);
      });
      for (var k = 1; k < 4; k++) {
        (function (k) { later(t + 140 + k * 450, function () { stepsAt(k, q); }); })(k);
      }
      later(t + 140 + 4 * 450, function () {
        showAnswer(q);
        stepsAt(4, q);
        ap.classList.remove("waiting");
      });
      return t + 140 + 4 * 450;
    }
    function tour(t, end) {
      later(t + 300, function () { scrollTo(offset(card) - 16, 900); });
      later(t + 2600, function () { scrollTo(offset(sources) - 12, 1300); });
      later(t + 5500, function () { scrollTo(end(), 1100); });
    }

    function finish() {
      clear();
      ap.className = "apw-scale ap";
      ap.setAttribute("data-asked", "2");
      typed.textContent = qs[1];
      countN.textContent = qs[1].length;
      showAnswer(2);
      stepsAt(4, 2);
      setY(restY());
    }
    function play() {
      clear();
      slide.classList.add("instant");
      ap.className = "apw-scale ap empty waiting";
      ap.setAttribute("data-asked", "0");
      typed.textContent = "";
      countN.textContent = "0";
      showAnswer(1);
      stepsAt(-1, 1);
      setY(0);
      void slide.offsetWidth;
      slide.classList.remove("instant");

      later(600, function () { ap.classList.add("typing"); });
      var t = ask(1, type(qs[0], 800) + 350);
      tour(t, function () { return 0; });
      t += 6800;
      later(t, function () {
        typed.textContent = "";
        countN.textContent = "0";
        ap.classList.add("typing", "empty");
      });
      t = ask(2, type(qs[1], t + 300) + 350);
      tour(t, restY);
    }
    return { play: play, finish: finish };
  }

  // ---------- The MariaDB slide: one question asked as of 1 Jan 2020 and today, and the SQL behind it ----------
  // Real responses: 37 000 dead as of 2020, 38 000 today. The drawer shows the statement that did it,
  // a vector search joined to paragraph FOR SYSTEM_TIME AS OF, and its two halves light up in turn.

  function thenNowDemo(slide) {
    var ap = slide.querySelector(".ap");
    var view = ap.querySelector(".ap-view");
    var page = ap.querySelector(".ap-page");
    var form = ap.querySelector(".ap-form");
    var then = ap.querySelector(".tn-then");
    var bodies = ap.querySelectorAll(".ap-step-body");
    var steps = ap.querySelectorAll(".ap-step");
    var right = slide.querySelector(".tn-right");
    var drawer = slide.querySelector(".sqd");
    var timers = [];
    var raf = 0;
    var y = 0;
    var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };

    function later(ms, fn) { timers.push(setTimeout(fn, ms)); }
    function clear() {
      timers.forEach(clearTimeout);
      timers = [];
      cancelAnimationFrame(raf);
      raf = 0;
    }
    function offset(el) {
      var t = 0;
      for (; el && el !== page; el = el.offsetParent) t += el.offsetTop;
      return t;
    }
    function setY(v) {
      y = Math.max(0, Math.min(page.offsetHeight - view.clientHeight, v));
      page.style.transform = "translateY(" + (-y).toFixed(1) + "px)";
    }
    function scrollTo(target, ms) {
      cancelAnimationFrame(raf);
      var from = y;
      var t0 = performance.now();
      (function step(now) {
        var p = Math.min(1, (now - t0) / ms);
        setY(from + (target - from) * (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2));
        if (p < 1) raf = requestAnimationFrame(step);
      })(t0);
    }
    function stepsAt(n) {
      each(steps, function (li, k) {
        li.classList.toggle("done", k < n || n === 4);
        li.classList.toggle("active", k === n);
      });
      each(bodies, function (b) { b.textContent = b.getAttribute(n === 4 ? "data-d1" : "data-idle"); });
    }
    function tracks(vec, time) {
      [drawer, right].forEach(function (el) {
        el.classList.toggle("no-vec", !vec);
        el.classList.toggle("no-time", !time);
      });
    }

    function finish() {
      clear();
      ap.className = "apw-scale ap";
      ap.setAttribute("data-asked", "1");
      stepsAt(4);
      drawer.classList.remove("empty");
      tracks(true, true);
      setY(offset(then) - 12);
    }
    function play() {
      clear();
      slide.classList.add("instant");
      ap.className = "apw-scale ap waiting unmarked";
      ap.setAttribute("data-asked", "0");
      stepsAt(-1);
      drawer.classList.add("empty");
      tracks(false, false);
      setY(0);
      void slide.offsetWidth;
      slide.classList.remove("instant");

      later(900, function () { ap.classList.add("pressing"); });
      later(1040, function () {
        ap.classList.remove("pressing");
        ap.setAttribute("data-asked", "1");
        stepsAt(0);
        scrollTo(offset(form) - 12, 700);
      });
      for (var k = 1; k < 4; k++) {
        (function (k) { later(1040 + k * 450, function () { stepsAt(k); }); })(k);
      }
      later(2840, function () {
        stepsAt(4);
        ap.classList.remove("waiting");
        ap.classList.add("unmarked-b");
        drawer.classList.remove("empty");
      });
      later(3200, function () { scrollTo(offset(then) - 12, 1000); });
      later(4600, function () { ap.classList.remove("unmarked"); });
      later(5600, function () { ap.classList.remove("unmarked-b"); });
      later(6900, function () { tracks(true, false); });
      later(8100, function () { tracks(true, true); });
    }
    return { play: play, finish: finish };
  }

  var demos = slides.map(function (s) {
    var kind = s.getAttribute("data-demo");
    if (kind === "workflow") return workflowDemo(s);
    if (kind === "pipeline") return pipelineDemo(s);
    if (kind === "timemachine") return timeMachineDemo(s);
    if (kind === "crosslang") return crossLangDemo(s);
    if (kind === "ask") return askDemo(s);
    if (kind === "thennow") return thenNowDemo(s);
    return null;
  });

  // ---------- One animation loop, running only while a slide with the moon is on screen ----------

  var raf = 0;
  var last = 0;
  function animatedSlideActive() {
    var s = slides[cur];
    return moons.some(function (m) { return m.slide === s; }) || (net && net.slide === s);
  }
  function tick(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    angle += (TAU / CYCLE_SECONDS) * dt;
    drawMoons();
    if (net && net.slide === slides[cur]) net.draw(now, true);
    raf = document.hidden || !animatedSlideActive() ? 0 : requestAnimationFrame(tick);
  }
  function wake() {
    if (STILL || raf || !animatedSlideActive()) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) wake();
  });

  drawMoons();
  if (net) net.draw(0, false);
  demos.forEach(function (d) { if (d) d.finish(); });
  go(fromHash());

  // Tell the page around the deck what it holds; again whenever it asks, in case it was not listening yet.
  sendReady();

  if (PRINT) {
    window.addEventListener("load", function () {
      setTimeout(function () { window.print(); }, 300);
    });
  }
})();
