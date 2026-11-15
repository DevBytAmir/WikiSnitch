/* The deck's page: drives the embedded slides (index.html ⇄ slides.html, by postMessage, so it also
   works when the files are opened straight from disk), lists every slide and switches the theme. */
(function () {
  "use strict";

  var root = document.documentElement;
  var frame = document.getElementById("frame");
  var thumbs = document.getElementById("thumbs");
  var pos = document.getElementById("pos");
  var posTitle = document.getElementById("pos-title");
  var count = document.getElementById("count");
  var themeBtn = document.getElementById("theme");
  var titles = [];
  var cur = 0;
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };

  function send(msg) {
    msg.source = "wikisnitch-site";
    if (frame.contentWindow) frame.contentWindow.postMessage(msg, "*");
  }

  // ---------- Full screen: the frame itself goes full screen, so the deck keeps its keys ----------

  function present() {
    var req = frame.requestFullscreen || frame.webkitRequestFullscreen;
    if (req) {
      var p = req.call(frame);
      if (p && p.catch) p.catch(function () { window.open("slides.html#" + (cur + 1), "_blank"); });
    } else {
      window.open("slides.html#" + (cur + 1), "_blank");
    }
    frame.focus();
    try {
      frame.contentWindow.focus();
    } catch (e) {}
  }
  document.getElementById("present").addEventListener("click", present);
  document.getElementById("fullscreen").addEventListener("click", present);
  document.getElementById("prev").addEventListener("click", function () { send({ type: "prev" }); });
  document.getElementById("next").addEventListener("click", function () { send({ type: "next" }); });

  // Arrow keys and F on this page drive the preview too.
  document.addEventListener("keydown", function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t && t.closest && t.closest("input, textarea, select, button, a")) return;
    if (e.key === "ArrowRight") send({ type: "next" });
    else if (e.key === "ArrowLeft") send({ type: "prev" });
    else if (e.key === "f" || e.key === "F") present();
    else return;
    e.preventDefault();
  });

  // ---------- Every slide, as a picture made by build.mjs ----------

  function buildThumbs() {
    thumbs.textContent = "";
    titles.forEach(function (title, i) {
      var li = document.createElement("li");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "thumb";
      b.setAttribute("aria-label", "Show slide " + (i + 1) + ": " + title);
      var pic = document.createElement("span");
      pic.className = "thumb-img";
      var img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.src = "thumbs/" + pad(i + 1) + ".png";
      img.onerror = function () {
        // No picture yet (build.mjs not run): show the title instead.
        var f = document.createElement("span");
        f.className = "thumb-fallback";
        f.textContent = title;
        pic.replaceChild(f, img);
      };
      pic.appendChild(img);
      var meta = document.createElement("span");
      meta.className = "thumb-meta";
      var n = document.createElement("span");
      n.className = "thumb-n";
      n.textContent = pad(i + 1);
      var tt = document.createElement("span");
      tt.className = "thumb-title";
      tt.textContent = title;
      meta.appendChild(n);
      meta.appendChild(tt);
      b.appendChild(pic);
      b.appendChild(meta);
      b.addEventListener("click", function () {
        send({ type: "go", index: i });
        frame.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      li.appendChild(b);
      thumbs.appendChild(li);
    });
    count.textContent = String(titles.length);
    mark();
  }

  function mark() {
    pos.textContent = pad(cur + 1) + " / " + pad(titles.length || 1);
    posTitle.textContent = titles[cur] || "";
    Array.prototype.forEach.call(thumbs.querySelectorAll(".thumb"), function (b, i) {
      b.setAttribute("aria-current", i === cur ? "true" : "false");
    });
  }

  // ---------- Theme, shared with the deck ----------

  function setTheme(t, tellDeck) {
    if (t === "dark") root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
    themeBtn.querySelector("use").setAttribute("href", t === "dark" ? "#i-sun" : "#i-moon");
    themeBtn.querySelector(".theme-text").textContent = t === "dark" ? "Light" : "Dark";
    themeBtn.setAttribute("aria-label", t === "dark" ? "Switch to the light theme" : "Switch to the dark theme");
    try {
      localStorage.setItem("wikisnitch-theme", t);
    } catch (e) {}
    if (tellDeck) send({ type: "theme", theme: t });
  }
  var theme = function () { return root.getAttribute("data-theme") === "dark" ? "dark" : "light"; };
  setTheme(theme(), false);
  themeBtn.addEventListener("click", function () { setTheme(theme() === "dark" ? "light" : "dark", true); });

  // ---------- Messages from the deck ----------

  window.addEventListener("message", function (e) {
    if (e.source !== frame.contentWindow) return;
    var m = e.data;
    if (!m || m.source !== "wikisnitch-deck") return;
    if (m.type === "ready") {
      titles = Array.isArray(m.titles) ? m.titles.map(String) : [];
      cur = m.index | 0;
      buildThumbs();
      if (m.theme !== theme()) send({ type: "theme", theme: theme() });
    } else if (m.type === "slide") {
      cur = m.index | 0;
      mark();
    } else if (m.type === "theme") {
      setTheme(m.theme === "dark" ? "dark" : "light", false);
    } else if (m.type === "fullscreen") {
      present();
    }
  });

  // The deck announces itself when it loads; ask again in case that happened before this script ran.
  frame.addEventListener("load", function () { send({ type: "hello" }); });
  send({ type: "hello" });
})();
