// The motion of the shell (ADR-0027; its values are the layer's tokens --mv-*, web/couche-runward-app.css; its
// rules are web/mouvement.css). It says what changed and where it went; it never decorates a screen of data.
//
// What is held here, for every moment:
//   - transform and opacity only (one exception, said: the clip-path of the window that unfolds, a paint, never an
//     animated layout); the layout changes once, at once, then a transform makes the way (FLIP);
//   - every animation that starts ends: each has its guard (its duration, its delay and 300 ms), which forces it to its
//     end; the state at rest is always the final state (fill backwards), so an animation that does not start leaves
//     the screen whole;
//   - nothing blocks a gesture: a new gesture takes everything that runs to its end at once (finirTout), then plays;
//   - reduced motion: no transform at all; an immediate change, or a fade of 160 ms at most;
//   - no inline script or style element (the app's CSP): styles go through the CSSOM and the Web Animations API.
// It imports the base only: every module of the shell may call it.
import { main, colonneEl } from "./base.js";

const h = document.documentElement;
let mql = null;
/** Whether the reader asked for reduced motion. */
export const reduit = () => { mql ??= typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false }; return Boolean(mql.matches); };

// ------------------------------------------------------------- the tokens, read from the layer (never written here)
let T = null;
/** The layer's motion tokens, in milliseconds and pixels. A token that cannot be read is 0: no token, no motion. */
export function jetons() {
  if (T) return T;
  const cs = typeof window.getComputedStyle === "function" ? window.getComputedStyle(h) : null;
  const n = (name) => { const v = parseFloat(cs?.getPropertyValue(name) ?? ""); return Number.isFinite(v) ? v : 0; };
  T = { d1: n("--mv-d1"), d2: n("--mv-d2"), d3: n("--mv-d3"), ecran: n("--mv-ecran"), pas: n("--mv-pas"), monte: n("--mv-monte"), pose: n("--mv-pose"), tenue: n("--mv-tenue"), eclat: n("--mv-eclat"), seuil: n("--mv-seuil"), doux: (cs?.getPropertyValue("--mv-doux") ?? "").trim() || "linear" };
  return T;
}
/** The margin a guard leaves an animation before it forces it to its end. */
export const GARDE = 300;
const delai = (t) => new Promise((r) => setTimeout(r, t));

// ------------------------------------------------------------- the engine: an animation, its guard, its end
const vivantes = new Set();
let vt = null;
/** How many animations of the engine have started and not ended (a view transition under way counts for one). */
export const enCours = () => vivantes.size + (vt ? 1 : 0);
/** The frames without their transforms, for reduced motion; null when nothing but a transform was animated. */
export function sansTransform(frames) {
  const f = frames.map((k) => (k.opacity === undefined ? null : { opacity: k.opacity, ...(k.visibility === undefined ? {} : { visibility: k.visibility }), ...(k.offset === undefined ? {} : { offset: k.offset }) }));
  return f.every(Boolean) ? f : null;
}
/**
 * Animate an element; the promise is kept when the animation ended, or was forced to its end by its guard.
 * Under reduced motion the transforms are taken out (nothing left: no animation) and the duration is 160 ms at most.
 */
export function anim(el, frames, o = {}) {
  if (!el || typeof el.animate !== "function") return Promise.resolve();
  const t = jetons();
  let f = frames, d = o.duration ?? t.d2, attente = o.delay ?? 0;
  if (reduit()) { f = sansTransform(frames); if (!f) return Promise.resolve(); d = Math.min(d, t.d1); attente = 0; }
  const a = el.animate(f, { duration: d, delay: attente, easing: o.easing ?? t.doux, fill: o.fill ?? "backwards" });
  vivantes.add(a);
  const finir = () => { if (a.playState !== "finished" && a.playState !== "idle") { try { a.finish(); } catch { a.cancel(); } } };
  const garde = delai(d + attente + (o.garde ?? GARDE)).then(finir);
  const p = Promise.race([Promise.resolve(a.finished).catch(() => {}), garde]).then(() => { vivantes.delete(a); });
  p.a = a;
  return p;
}
/** Everything that runs goes to its end, at once: a new gesture never waits for an animation. */
export function finirTout() {
  for (const a of [...vivantes]) { try { a.finish(); } catch { a.cancel(); } }
  if (vt) { try { vt.skipTransition(); } catch { /* already over */ } vt = null; }
}

// ------------------------------------------------------------- 1. from screen to screen
// What is carried from one screen to the next: one name per piece, set through the CSSOM just before the change and
// taken off after it (a named piece is its own layer: it is named only while it travels). To shorten what a slow
// machine carries, take a line off this list: the reading's window first (the author's decision of 2026-11-11).
const visible = (sel, root = document) => [...root.querySelectorAll(sel)].find((e) => e.getClientRects().length > 0) ?? null;
const PORTEES = [
  ["mv-marque", () => visible(".lat .marque, .top .marque")],
  ["mv-outils", () => visible(".top .outils")],
  ["mv-titre", () => visible("main .t-hero, main .tete > h1, main > h1.v, main [data-view='portfolio'] > [data-role='title'], main .dash h1")],
  ["mv-fenetre", () => visible(".hero-e .scr, main > .scr.verre, main > .lecture > .scr.verre, main .dash > .scr.verre, main > ol.steps > li:not(.ferme)")],
  ["mv-lat", () => visible("#lat")],
  ["mv-pied", () => visible("#pied")],
  ["mv-repere", () => visible(".lat .repere")],
];
let nommes = [];
const nom = (el, n) => { if (el) { el.style.viewTransitionName = n; nommes.push(el); } };
/** Name the pieces of the screen on the page. `app`: the application whose row is, or becomes, its reading's window. */
function nommer(app, scene) {
  if (scene) nom(document.getElementById("corps"), "mv-scene");
  nom(document.getElementById("scn"), "mv-sol");
  if (reduit()) return; // reduced motion: one fade, nothing is carried
  for (const [n, find] of PORTEES) nom(find(), n);
  h.classList.add("mv-noms"); // the portfolio's window is a box of the stylesheet: its name is a rule (web/mouvement.css)
  const lect = main.querySelector('[data-view="application"]');
  const row = !lect && app ? [...main.querySelectorAll('[data-role="application"]')].find((li) => li.dataset.mission === app) : null;
  const piece = lect ?? row;
  if (piece) { nom(piece, "mv-lecture"); nom(piece.querySelector('[data-role="name"]'), "mv-nom"); nom(piece.querySelector('[data-role="state"]'), "mv-etat"); }
}
function denommer() { for (const el of nommes) el.style.viewTransitionName = ""; nommes = []; h.classList.remove("mv-noms"); }
const porteeOuDedans = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) if (x.style.viewTransitionName) return true; return Boolean(e.querySelector?.('[style*="view-transition-name"]')); };

// 2. the arrival: the blocks rise and appear, staggered, once; never a carried piece nor a block that holds one
const ARRIVANTS = ".hero-t > *, .hero-t > [data-actif] > *, main .tete > *, main > .kick, main > h1.v, main > .face, main > .actions, main > .note, [data-view='portfolio'] > [data-role='title'], [data-view='portfolio'] > [data-role='lede'], [data-role='group'], [data-role='application'], .lecture > .bandeau, .lecture > .actions, .lecture > .avert, .lecture-d > *, .lecture-schema > li, .lecture-source > h2, #bandeaux > .bandeau, .reglages > *, ol.steps > li, ol.journal > li, .dash > *, main > section, main > form, main > .grid2 > *";
function arriver(retard = 0) {
  if (reduit()) return Promise.resolve();
  const t = jetons(), bas = window.innerHeight;
  const c = [...document.querySelectorAll(ARRIVANTS)].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top < bas && r.bottom > 0 && !porteeOuDedans(e); });
  const pas = Math.min(t.pas, t.seuil / Math.max(1, c.length));
  return Promise.all(c.map((e, i) => anim(e, [{ opacity: 0, transform: `translateY(${t.monte}px)` }, { opacity: 1, transform: "none" }], { duration: t.d3, delay: retard + i * pas })));
}

let premier = true;
/**
 * Change the screen: `maj` paints the new one. A view transition of the same document where the browser has them,
 * else a fade. `arrivee`: the blocks of the new screen arrive (a navigation forward; never a refresh, a switch of
 * language or a way back). `vite`: the same screen said again (the language, the end of a loading), 320 ms; `court`:
 * a skeleton that appears, 240 ms. `app`: the
 * application whose row becomes its reading's window, or the reverse.
 */
export async function ecran(maj, { arrivee = true, vite = false, court = false, app = null } = {}) {
  finirTout();
  const t = jetons();
  let arr = Promise.resolve(), err = null;
  const direct = arrivee && !reduit();
  // the first paint of the page has nothing to leave: it is painted, and its blocks arrive
  if (premier) { premier = false; maj(); if (direct) await arriver(0); return; }
  const poser = () => {
    try { maj(); } catch (e) { err = e; return; }
    denommer();
    // the screen that arrives is not photographed when its blocks arrive: they move live, under the old one that fades
    nommer(app, !direct);
    if (direct) arr = arriver(t.d1 / 2);
  };
  if (typeof document.startViewTransition !== "function") {
    const sortie = anim(colonneEl, [{ opacity: 1 }, { opacity: 0 }], { duration: t.d1, fill: "both" });
    await sortie;
    poser(); denommer(); sortie.a?.cancel(); // the same frame: the new screen takes over from the fade
    await anim(colonneEl, [{ opacity: 0 }, { opacity: 1 }], { duration: t.d2 });
  } else {
    h.classList.toggle("mv-vite", vite && !court); h.classList.toggle("mv-court", court);
    nommer(app, true);
    const tr = document.startViewTransition(poser); vt = tr;
    const duree = court ? t.d2 : vite ? t.d3 : t.ecran;
    await Promise.race([Promise.resolve(tr.ready).catch(() => {}), delai(2000)]); // the screen is painted and photographed
    await Promise.race([Promise.resolve(tr.finished).catch(() => {}), delai(duree + GARDE)]); // the guard counts from its real start
    if (vt === tr) { try { tr.skipTransition(); } catch { /* over */ } vt = null; }
    denommer(); h.classList.remove("mv-vite", "mv-court");
  }
  if (err) throw err;
  await arr;
}

// 10. loading: nothing before 300 ms, then a still skeleton that fades in
/** `montrer` paints the skeleton, 300 ms from now unless `fin()` is called first; `fin()` says whether it was shown. */
export function charger(montrer) {
  let vu = false;
  const id = setTimeout(() => { vu = true; ecran(montrer, { arrivee: false, court: true }); }, jetons().seuil);
  return { fin() { clearTimeout(id); return vu; } };
}
/** A message that settles (an error, a refusal): opacity and 6 px, a little after the screen. */
export function poserMessages(retard = jetons().d1 / 2) {
  const t = jetons();
  return Promise.all([...main.querySelectorAll('[data-erreur], .erreur[role="alert"]')].map((e) => anim(e, [{ opacity: 0, transform: `translateY(${t.pose}px)` }, { opacity: 1, transform: "none" }], { duration: t.d2, delay: retard })));
}

// ------------------------------------------------------------- 3. the passkey's ceremony: states stacked in one cell
/** The states of a pile: show `k` (the others stay in the cell, hidden: the window never changes its size). */
export function porte(k, sec = false) {
  const t = jetons(), ps = [];
  let found = false;
  for (const pile of main.querySelectorAll(".pile")) {
    const cur = pile.querySelector(":scope > [data-actif]"), suiv = [...pile.children].find((e) => e.dataset.porte === k);
    if (!suiv) continue;
    found = true;
    if (suiv === cur) continue;
    if (cur) { cur.removeAttribute("data-actif"); cur.inert = true; }
    suiv.setAttribute("data-actif", ""); suiv.inert = false;
    if (sec) continue;
    if (cur) ps.push(anim(cur, [{ opacity: 1, visibility: "visible" }, { opacity: 0, visibility: "visible" }], { duration: t.d1 }));
    ps.push(anim(suiv, [{ opacity: 0, transform: `translateY(${t.pose}px)` }, { opacity: 1, transform: "none" }], { duration: t.d2, delay: t.d1 / 2 }));
  }
  return found ? Promise.all(ps) : null;
}
/** A check that draws itself: a shutter that slides (two opposite transforms), never an animated path. */
export function coche(c, d, retard = 0) {
  if (!c) return Promise.resolve();
  anim(c.querySelector(".essuie"), [{ transform: "translateX(-100%)" }, { transform: "none" }], { duration: d, delay: retard });
  return anim(c.querySelector(".trait"), [{ transform: "translateX(100%)" }, { transform: "none" }], { duration: d, delay: retard });
}
/** The passkey was accepted: the disc appears, the check draws itself (600 ms in all), then the caller changes the screen. */
export async function reussite() {
  const t = jetons();
  if (porte("succes") === null) return;
  await Promise.all([coche(main.querySelector('[data-porte="succes"] .coche-m'), t.d3, t.d1), delai(reduit() ? t.d1 : t.d1 + t.d3 + 120)]);
}

// ------------------------------------------------------------- 4. fold, unfold (FLIP)
// The folds of the reading are runward-fleet's own <details>. The layout changes once (the browser opens the fold);
// what is below starts from its old place (transform), the window uncovers itself (clip-path, a paint), the content
// appears 60 ms later. Closing is the same way back, then the fold closes. Nothing above moves; the focus stays on
// the summary.
/** What may move when `el` changes its height: what follows it and each of its ancestors, to the page's foot. */
function suiteDe(el) {
  const out = [];
  for (let x = el; x && x !== main && x !== document.body; x = x.parentElement) for (let s = x.nextElementSibling; s; s = s.nextElementSibling) out.push(s);
  const pied = document.getElementById("pied"); if (pied) out.push(pied);
  return out;
}
const contenu = (d) => [...d.children].filter((c) => c.tagName !== "SUMMARY");
const fenetreDe = (d) => d.closest("[data-view]") ?? d.parentElement;
let releve = null;
/** Just before a fold opens: where everything below it is. */
export function avantPli(d) {
  finirTout();
  const suite = suiteDe(d);
  releve = { d, suite, avant: suite.map((e) => e.getBoundingClientRect().top), h0: fenetreDe(d).offsetHeight };
}
/** The fold `d` is open: play the way from the places read before. */
export function deplier(d) {
  const r = releve; releve = null;
  const t = jetons();
  if (reduit()) return Promise.all(contenu(d).map((c) => anim(c, [{ opacity: 0 }, { opacity: 1 }], { duration: t.d1 })));
  if (!r || r.d !== d) return Promise.resolve();
  const art = fenetreDe(d), dh = art.offsetHeight - r.h0, o = { duration: t.d3 };
  r.suite.forEach((e, i) => { const dy = r.avant[i] - e.getBoundingClientRect().top; if (Math.abs(dy) > 0.5) anim(e, [{ transform: `translateY(${dy}px)` }, { transform: "none" }], o); });
  if (dh > 0) anim(art, [{ clipPath: `inset(-80px -80px ${dh}px -80px)` }, { clipPath: "inset(-80px -80px 0px -80px)" }], o);
  return Promise.all(contenu(d).map((c) => anim(c, [{ opacity: 0 }, { opacity: 1 }], { duration: t.d3, delay: 60 })));
}
/** Close the fold `d`: the way back, shorter, then the fold closes in the frame the transforms end. */
export async function replier(d) {
  finirTout();
  const t = jetons();
  if (reduit()) { d.open = false; return; }
  const suite = suiteDe(d), art = fenetreDe(d);
  const avant = suite.map((e) => e.getBoundingClientRect().top), h0 = art.offsetHeight;
  d.open = false;
  const apres = suite.map((e) => e.getBoundingClientRect().top), dh = h0 - art.offsetHeight;
  d.open = true;
  const o = { duration: t.d2 + 40, fill: "both" };
  const ps = [...suite.map((e, i) => { const dy = apres[i] - avant[i]; return Math.abs(dy) > 0.5 ? anim(e, [{ transform: "none" }, { transform: `translateY(${dy}px)` }], o) : Promise.resolve(); }),
    dh > 0 ? anim(art, [{ clipPath: "inset(-80px -80px 0px -80px)" }, { clipPath: `inset(-80px -80px ${dh}px -80px)` }], o) : Promise.resolve(),
    ...contenu(d).map((c) => anim(c, [{ opacity: 1 }, { opacity: 0 }], { duration: t.d1, fill: "both" }))];
  await Promise.all(ps);
  d.open = false; ps.forEach((p) => p.a?.cancel()); // the same frame: the layout takes over from the transforms
}

// ------------------------------------------------------------- 5. the theme: a fade of the whole page
/** `changer` sets the other theme; nothing changes its place. */
export async function theme(changer) {
  const t = jetons();
  if (typeof document.startViewTransition !== "function") { changer(); return; }
  if (vt) { try { vt.skipTransition(); } catch { /* over */ } vt = null; }
  denommer(); h.classList.add("mv-theme");
  const tr = document.startViewTransition(changer); vt = tr;
  await Promise.race([Promise.resolve(tr.ready).catch(() => {}), delai(2000)]);
  await Promise.race([Promise.resolve(tr.finished).catch(() => {}), delai(t.d2 + GARDE)]);
  if (vt === tr) { try { tr.skipTransition(); } catch { /* over */ } vt = null; }
  h.classList.remove("mv-theme");
}

// ------------------------------------------------------------- 7. copy: the label gives way to a check and « Copié »
/** The button keeps its width (its two labels are stacked); the check draws itself; held, then back. */
export async function copie(btn) {
  const t = jetons();
  const pile = btn.querySelector(".pile"); if (!pile) return;
  const [a, c] = pile.children;
  if (c.hasAttribute("data-actif")) return;
  const bascule = (de, vers) => { de.removeAttribute("data-actif"); vers.setAttribute("data-actif", ""); anim(de, [{ opacity: 1, visibility: "visible" }, { opacity: 0, visibility: "visible" }], { duration: t.d1 }); return anim(vers, [{ opacity: 0 }, { opacity: 1 }], { duration: t.d2, delay: t.d1 / 2 }); };
  bascule(a, c); coche(c.querySelector(".coche-m"), t.d2, t.d1 / 2);
  await delai(t.tenue);
  if (btn.isConnected && c.hasAttribute("data-actif")) await bascule(c, a);
}

// ------------------------------------------------------------- 8. a check arrives while the portfolio is read
/** What the portfolio says now, to compare with what it says after its next paint: the tiles, the rows, the date. */
export function releverPortefeuille() {
  const port = main.querySelector('.lecture[data-vue="port"]');
  if (!port) return null;
  const rect = (e) => { const r = e.getBoundingClientRect(); return { left: r.left + window.scrollX, top: r.top + window.scrollY, width: r.width, height: r.height }; };
  return {
    tuiles: new Map([...port.querySelectorAll('[data-role="group"]')].map((g) => { const n = g.querySelector(".frac > .n"); return [g.dataset.state, n ? { texte: n.textContent, rect: rect(n), style: window.getComputedStyle(n) } : null]; })),
    lignes: new Map([...port.querySelectorAll('[data-role="application"]')].map((li) => [li.dataset.mission, { html: li.innerHTML, top: li.getBoundingClientRect().top, hauteur: li.offsetHeight }])),
    maj: port.querySelector(".lecture-maj")?.textContent ?? "",
  };
}
/**
 * The portfolio was painted again, on the same address, with another check: the number of a tile rolls, the row
 * fades in, the rows below slide if its height changed, a veil goes out on the row, the bar's date fades in. No
 * arrival. Nothing is added inside runward-fleet's HTML: the number that leaves and the veil are laid over the page.
 */
export function controleArrive(avant) {
  const port = main.querySelector('.lecture[data-vue="port"]');
  if (!avant || !port) return 0;
  const t = jetons();
  let n = 0;
  const calque = (r, cls) => { const s = document.createElement("span"); s.className = cls; s.setAttribute("aria-hidden", "true"); Object.assign(s.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` }); document.body.append(s); return s; };
  for (const g of port.querySelectorAll('[data-role="group"]')) {
    const el = g.querySelector(".frac > .n"), was = avant.tuiles.get(g.dataset.state);
    if (!el || !was || was.texte === el.textContent) continue;
    n++;
    if (!reduit()) { const s = calque(was.rect, "mv-sort"); s.textContent = was.texte; Object.assign(s.style, { font: was.style.font, letterSpacing: was.style.letterSpacing, color: was.style.color, lineHeight: `${was.rect.height}px` }); anim(s, [{ transform: "none", opacity: 1 }, { transform: "translateY(-55%)", opacity: 0 }], { duration: t.d2, fill: "both" }).then(() => s.remove()); }
    anim(el, [{ transform: "translateY(55%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: t.d2, delay: 40 });
  }
  let glisse = 0;
  for (const li of port.querySelectorAll('[data-role="application"]')) {
    const was = avant.lignes.get(li.dataset.mission);
    if (glisse && !reduit()) anim(li, [{ transform: `translateY(${-glisse}px)` }, { transform: "none" }], { duration: t.d3 });
    if (!was || was.html === li.innerHTML) continue;
    n++;
    anim(li, [{ opacity: 0 }, { opacity: 1 }], { duration: t.d2 });
    glisse += li.offsetHeight - was.hauteur;
    const r = li.getBoundingClientRect();
    const e = calque({ left: r.left + window.scrollX, top: r.top + window.scrollY, width: r.width, height: r.height }, "mv-eclat");
    anim(e, [{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: t.eclat, fill: "both" }).then(() => e.remove());
  }
  const maj = port.querySelector(".lecture-maj");
  if (maj && maj.textContent !== avant.maj) { n++; anim(maj, [{ opacity: 0 }, { opacity: 1 }], { duration: t.d2 }); }
  return n;
}
