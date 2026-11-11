// The base every module of the shell stands on: the page's fixed elements, the one Trusted Types policy
// (the only sink of HTML), the escaping, the state of the page and the address it reads. It imports nothing.

export const META = (n) => document.querySelector(`meta[name="${n}"]`)?.content ?? "";
export const COMMIT = META("runward-commit");
const tt = window.trustedTypes ? window.trustedTypes.createPolicy("runward", { createHTML: (s) => s }) : null;
export const setHTML = (el, html) => { el.innerHTML = tt ? tt.createHTML(html) : html; };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (id) => document.getElementById(id);
export const main = $("main"), stampEl = $("stamp"), latEl = $("lat"), mobNavEl = $("mobnav"), menuBtnEl = $("menub"), colonneEl = $("colonne");
export const filEls = [$("fil"), $("fil2")], langueEls = [$("langue"), $("langue2")];
export const bandEl = $("bandeaux"), piedEl = $("pied"), annonceEl = $("annonce"), barTelEl = $("bartel");
export const short = (h) => (h ? `${String(h).slice(0, 12)}…` : "");

// The state of the page, one object: what was read (session, index, status, access, journal) and what a
// gesture is doing (confirming, busy, failed). A module reads and writes it by its fields.
export const S = { session: undefined, index: null, status: null, access: null, journal: null, intent: null, link: null, linkInfo: null, newVersion: false, confirming: null, busy: null, failed: null, error: null, export: null, offline: false, origine: null, cibleVue: null, vuePeinte: null };

/** The address as the router reads it: #/<route>/<sub>. */
export const parts = () => { const h = location.hash.replace(/^#\/?/, ""); const p = h.split("/"); return { h, route: p[0], sub: p.slice(1).join("/") }; };
