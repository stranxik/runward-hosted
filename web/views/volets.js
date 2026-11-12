// The panes of the fixed shell (ADR-0036): a screen of work is one window, its bar (what the screen holds in one line,
// its filters, the time of its last read), a list pane and a detail pane, each scrolling on its own; the page itself
// never scrolls on a desk (1024 px and more, web/coque.css). On a phone the list is one screen and the detail another,
// with its way back in the top bar and the tab bar at the bottom. Applications is built on these (web/views/decision.js);
// Journal and Compte use the same, and nothing else of this file needs to change for them.
//
// THE CONTRACT, for every screen that uses the panes:
//   1. Its view returns { main: "volets", ecran, cle, sel, html, focus }: `ecran` is "detail" when the address names one
//      item (a phone then shows the detail and the way back), else "liste"; `cle` names the screen (a repaint of the
//      same `cle` keeps the scroll of its list), `sel` the item shown (the same `sel` keeps the scroll of the detail and
//      its open folds); `focus` is VOLET_FOCUS unless the screen wants another. The shell (web/views/shell.js#paint)
//      sets body[data-ecran], calls garder() before it writes the screen and rendre() after.
//   2. fenetre({ bar, liste, detail, seul, label }) is the window. `bar`: barre({ titre, synth, filtres, direct, extra });
//      `liste`: the list pane (bandeau, tete, then rows); `detail`: the detail pane (entete, then corps); `seul`: one
//      pane alone, for a state with nothing to list (empty, error, first run): the list and detail are left out.
//   3. rangee({ href, cle, courant, choisie, html, cls }) is one row of a list: a link to its detail's address, `cle` its
//      key (the focus stays on it across a repaint), `courant` when the detail shows it by its address (aria-current),
//      `choisie` when the desk shows it by default (no address names it; drawn as current, not said as such).
//      liste(rows, label) wraps the rows: up and down move from row to row (a desk also opens the row reached).
//   4. entete({ meta, titre, phrase, actions, pas }) is the sticky head of a detail; pas({ i, n, avant, apres, ... }) its
//      previous and next. corps(html) holds the rest; feuille({ titre, sous, corps, cls, id }) a sheet in it;
//      pli({ cle, titre, corps, ouvert, id }) a fold whose state a repaint keeps; colonnes(main, side) two columns
//      when the detail is wide enough (a container query), one otherwise.
//   5. etat({ marque, titre, texte, actions, h1 }) is a state inside a pane (empty, error, unknown, no result), its title
//      the screen's heading when `h1` (the pane holds nothing else that names the screen);
//      squelette(n) the skeleton of a list and a detail while the screen reads (no number, no word but its label).
// The motion: a new selection brings its detail in, and on a phone the screen that comes in slides a few pixels; both
// are transitions that a class starts and that end, the classes taken off after FAILSAFE whatever happens; reduced
// motion removes them (web/famille.css). Every value is escaped by the caller: these functions take HTML pieces.
import { S, esc, main } from "./base.js";

/** The focus a pane screen asks: the row it was on (kept by its data-focus-key), else on a phone the detail's heading. */
export const VOLET_FOCUS = "#volet-detail h1";
const FAILSAFE = 700;

// ------------------------------------------------------------- the HTML
export const barre = ({ titre = "", synth = "", filtres = "", direct = "", extra = "" } = {}) =>
  `${titre ? `<p class="wb-t">${titre}</p>` : ""}${synth ? `<p class="synth">${synth}</p>` : ""}${filtres}${direct}${extra}`;
export function fenetre({ bar = "", liste: l = "", detail = "", seul = "", label = "" } = {}) {
  const body = seul
    ? `<div class="win-body seul"><div class="pane detail" id="volet-detail">${seul}</div></div>`
    : `<div class="win-body"><div class="pane liste" id="volet-liste">${l}</div><div class="pane detail" id="volet-detail"${label ? ` aria-label="${esc(label)}"` : ""}>${detail}</div></div>`;
  return `<div class="win" data-volets>${bar ? `<div class="win-bar">${bar}</div>` : ""}${body}</div>`;
}
export const rangee = ({ href, cle, courant = false, choisie = false, html, cls = "" }) =>
  `<a class="row${cls ? ` ${cls}` : ""}${choisie ? " choisie" : ""}" href="${esc(href)}" data-focus-key="row:${esc(cle)}"${courant ? ' aria-current="true"' : ""}>${html}</a>`;
export const liste = (rows, label) => `<nav aria-label="${esc(label)}"><div class="rows" data-liste>${rows}</div></nav>`;
export const tete = (titre, note = "") => `<div class="l-h"><h2>${titre}</h2>${note ? `<p>${note}</p>` : ""}</div>`;
/** Previous and next: links to their address, or a still button when there is none. */
export function pas({ i, n, avant, apres, mots: W }) {
  const one = (href, label, dir, k) => (href
    ? `<a class="pas-b" href="${esc(href)}" aria-label="${esc(label)}" data-focus-key="pas:${k}">${ICONS[dir]}</a>`
    : `<span class="pas-b" aria-hidden="true">${ICONS[dir]}</span>`);
  return `<span class="pas">${one(avant, W.prev, "up", "-1")}<span class="pas-n" aria-label="${esc(W.posLabel(i, n))}">${esc(W.pos(i, n))}</span>${one(apres, W.next, "down", "1")}</span>`;
}
export const entete = ({ meta = "", titre, phrase = "", actions = "", pas: p = "" }) =>
  `<header class="d-head"><div class="d-meta">${meta}${p}</div><h1 tabindex="-1">${titre}</h1>${phrase ? `<p class="phrase">${phrase}</p>` : ""}${actions ? `<div class="d-act">${actions}</div>` : ""}</header>`;
export const corps = (html) => `<div class="d-body">${html}</div>`;
export const colonnes = (gauche, droite) => `<div class="d-cols"><div class="d-main">${gauche}</div><div class="d-side">${droite}</div></div>`;
export const feuille = ({ titre = "", sous = "", corps: c, cls = "", id = "", label = "" }) =>
  `<section class="sheet${cls ? ` ${cls}` : ""}"${id ? ` id="${esc(id)}"` : ""}${label ? ` aria-label="${esc(label)}"` : ""}>${titre ? `<div class="sh-h"><h2>${titre}</h2>${sous ? `<div class="sh-n">${sous}</div>` : ""}</div>` : ""}${c}</section>`;
export const pli = ({ cle, titre, corps: c, ouvert = false, id = "" }) =>
  `<details class="pli" data-pli="${esc(cle)}"${id ? ` id="${esc(id)}"` : ""}${ouvert ? " open" : ""}><summary data-focus-key="pli:${esc(cle)}">${titre}</summary><div class="pli-b">${c}</div></details>`;
export const etat = ({ marque = "", titre = "", texte = "", actions = "", h1 = false }) =>
  `<div class="etat">${marque}${titre ? (h1 ? `<h1 tabindex="-1">${titre}</h1>` : `<h2>${titre}</h2>`) : ""}${texte ? `<p>${texte}</p>` : ""}${actions ? `<div class="actions">${actions}</div>` : ""}</div>`;
export function squelette(n, label) {
  const row = `<div class="sk-row"><span class="sq sk-m"></span><span class="sk-t"><span class="sq sk-a"></span><span class="sq sk-b"></span></span><span class="sq sk-c"></span></div>`;
  return fenetre({
    bar: `<p class="vh" role="status">${esc(label)}</p><span class="charge" role="progressbar" aria-label="${esc(label)}"></span>`,
    liste: `<div aria-hidden="true">${row.repeat(n)}</div>`,
    detail: `<div class="d-body" aria-hidden="true"><span class="sq sk-h"></span><span class="sq sk-p"></span><span class="sq sk-r"></span><span class="sq sk-s"></span></div>`,
  });
}
const ICONS = {
  up: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3.5 10 8 5.5l4.5 4.5"/></svg>',
  down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3.5 6 8 10.5 12.5 6"/></svg>',
};

// ------------------------------------------------------------- around a paint (web/views/shell.js#paint)
const reduit = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const large = () => typeof matchMedia === "function" && matchMedia("(min-width:1024px)").matches;
const later = (f) => window.requestAnimationFrame(() => window.requestAnimationFrame(f));
/** A move that answers a gesture: `cls` sets its start, « go » its way to rest; both come off after FAILSAFE, whatever happens. */
export function entree(el, cls) {
  if (!el || reduit()) return;
  el.classList.add(cls);
  later(() => el.classList.add("go"));
  setTimeout(() => el.classList.remove(cls, "go"), FAILSAFE);
}

/** What a repaint keeps, read before the screen is written again: the scroll of each pane, the open folds, the focus. */
export function garder() {
  const l = main.querySelector?.("#volet-liste"), d = main.querySelector?.("#volet-detail");
  const a = document.activeElement;
  if (!S.focusKey && a && main.contains?.(a) && a.dataset?.focusKey) S.focusKey = a.dataset.focusKey;
  return { prev: S.volets ?? null, liste: l?.scrollTop ?? 0, detail: d?.scrollTop ?? 0, plis: [...(d?.querySelectorAll?.("details[data-pli][open]") ?? [])].map((x) => x.dataset.pli) };
}
/** After a pane screen is written: the same screen keeps its scroll and folds; a new selection comes in. */
export function rendre(memo, v) {
  const prev = memo?.prev;
  S.volets = { cle: v.cle ?? null, sel: v.sel ?? null, ecran: v.ecran ?? "liste" };
  const l = main.querySelector("#volet-liste"), d = main.querySelector("#volet-detail");
  const memeEcran = prev && prev.cle === S.volets.cle;
  const memeSel = memeEcran && prev.sel === S.volets.sel;
  if (l && memeEcran) l.scrollTop = memo.liste;
  if (d && memeSel) {
    d.scrollTop = memo.detail;
    for (const k of memo.plis) d.querySelector(`details[data-pli="${CSS.escape(k)}"]`)?.setAttribute("open", "");
  }
  if (memeSel) return;
  l?.querySelector('.row[aria-current="true"], .row.choisie')?.scrollIntoView?.({ block: "nearest" });
  if (d) entree(d.querySelector(".d-body"), "d-in");
  // on a phone, the screen that comes in (the detail, or the list on the way back) slides in from its side
  if (!large() && prev && prev.cle === S.volets.cle && prev.ecran !== S.volets.ecran) {
    const el = S.volets.ecran === "detail" ? d : l;
    if (S.volets.ecran !== "detail") el?.classList.add("retour-g");
    entree(el, "glisse");
    if (S.volets.ecran !== "detail") setTimeout(() => el?.classList.remove("retour-g"), FAILSAFE);
  }
}

// ------------------------------------------------------------- the keyboard in a list
// Up and down move from row to row, as in a desktop app; on a desk the row reached is opened beside it.
if (main && typeof main.addEventListener === "function" && typeof matchMedia === "function") {
  main.addEventListener("keydown", (e) => {
    if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || !e.target.closest?.("[data-liste]")) return;
    const rows = [...e.target.closest("[data-liste]").querySelectorAll(":scope > a")];
    const i = rows.indexOf(e.target.closest("a"));
    const next = rows[i + (e.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
    if (large()) location.hash = next.getAttribute("href");
  });
}
