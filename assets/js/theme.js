// Light and dark theme. Applies the visitor's saved choice at once (this file is loaded in <head>, so the page
// never flashes the wrong colours) and wires the theme button where the page has one.
(function () {
  "use strict";
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  } catch (e) {
    // Storage is blocked: the system preference still applies.
  }
  document.addEventListener("DOMContentLoaded", function () {
    var button = document.getElementById("theme");
    if (!button) return;
    button.addEventListener("click", function () {
      var current = root.getAttribute("data-theme");
      var dark = current ? current === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      var next = dark ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try {
        localStorage.setItem("theme", next);
      } catch (e) {
        // Storage is blocked: the choice lasts until the page is closed.
      }
    });
  });
})();
