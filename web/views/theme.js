// The theme selector of the shell: light by default (web/index.html), dark chosen by the viewer and kept in
// this browser (a per-viewer convenience: the page is right without it). Both themes are the app's layer
// (web/couche-runward-app.css), as on the home page.
//
// This module is the documented place of the selector. Its contract with the shell: any element carrying
// data-theme-btn switches the theme; the shell places those elements (web/index.html for the top bar,
// web/views/shell.js for the sidebar's foot and the phone menu). A lot that redraws the selector (two named
// states instead of one button, the system's preference) changes this file and those three places only.
import { theme } from "./mouvement.js";

(function selector() {
  const KEY = "runward-hosted-theme";
  let saved = null; try { saved = localStorage.getItem(KEY); } catch { saved = null; }
  if (saved === "dark" || saved === "light") document.documentElement.setAttribute("data-theme", saved);
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-theme-btn]")) return;
    const cur = document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    // a fade of the whole page; nothing changes its place (ADR-0027)
    theme(() => document.documentElement.setAttribute("data-theme", next));
    try { localStorage.setItem(KEY, next); } catch { /* a per-viewer convenience only */ }
  });
})();
