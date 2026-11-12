// The panes of the fixed shell (ADR-0036, web/views/volets.js): the primitives every screen of panes is built with
// (the window, a row, the head of a detail, previous and next, a state, the skeleton) and what a repaint keeps (the
// scroll of each pane, the open folds of the same item, the focus by its key). The modules are run as the app serves
// them, over a page reduced to what the panes touch. Each guard has its planted control.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { MODULES } from "../../src/http/assets.js";

const WEB = new URL("../../web/", import.meta.url).pathname;
const VIEWS = new URL("../../node_modules/runward-fleet/ui/views.js", import.meta.url);

// ---- the page reduced to what the panes touch: two panes, their folds, the focus
function pane(id) {
  const folds = new Map();
  return {
    id, scrollTop: 0, folds,
    querySelectorAll: (sel) => (sel === "details[data-pli][open]" ? [...folds].filter(([, open]) => open).map(([k]) => ({ dataset: { pli: k } })) : []),
    querySelector: (sel) => { const m = /details\[data-pli="([^"]+)"\]/.exec(sel); return m && folds.has(m[1]) ? { setAttribute: () => folds.set(m[1], true) } : null; },
  };
}
const page = { liste: pane("volet-liste"), detail: pane("volet-detail"), active: null };
const main = {
  querySelector: (sel) => (sel === "#volet-liste" ? page.liste : sel === "#volet-detail" ? page.detail : null),
  contains: (el) => el === page.active,
};
globalThis.window = globalThis;
globalThis.document = { getElementById: (id) => (id === "main" ? main : null), querySelector: () => null, get activeElement() { return page.active; } };
globalThis.CSS = { escape: (s) => s };
globalThis.matchMedia = () => ({ matches: true });
globalThis.localStorage = { getItem: () => null, setItem() {} };

const served = mkdtempSync(join(tmpdir(), "rw-volets-"));
after(() => rmSync(served, { recursive: true, force: true }));
for (const f of MODULES) { const p = join(served, f); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, readFileSync(join(WEB, f), "utf8").replace('"__VIEWS__"', JSON.stringify(VIEWS.href))); }
const V = await import(pathToFileURL(join(served, "views/volets.js")).href);
const { S } = await import(pathToFileURL(join(served, "views/base.js")).href);

test("the window: a bar, a list pane and a detail pane, or one pane alone for a state with nothing to list", () => {
  const w = V.fenetre({ bar: V.barre({ titre: "3 applications" }), liste: "L", detail: "D", label: "Vos <applications>" });
  assert.equal(w, '<div class="win" data-volets><div class="win-bar"><p class="wb-t">3 applications</p></div><div class="win-body"><div class="pane liste" id="volet-liste">L</div><div class="pane detail" id="volet-detail" aria-label="Vos &lt;applications&gt;">D</div></div></div>');
  const seul = V.fenetre({ seul: "E" });
  assert.equal(seul, '<div class="win" data-volets><div class="win-body seul"><div class="pane detail" id="volet-detail">E</div></div></div>');
  assert.equal(seul.includes("volet-liste"), false, "no list pane when nothing is listed");
});

test("a row: a link to its detail's address, its key for the focus, current when the address names it, chosen when a desk shows it by default", () => {
  const r = V.rangee({ href: "#/decision/a&b", cle: "a&b", courant: true, html: "x" });
  assert.equal(r, '<a class="row" href="#/decision/a&amp;b" data-focus-key="row:a&amp;b" aria-current="true">x</a>');
  const c = V.rangee({ href: "#/decision/b", cle: "b", choisie: true, html: "y" });
  assert.equal(c.includes("aria-current"), false, "shown by default: drawn as current, never said as such");
  assert.match(c, /class="row choisie"/);
  // planted control: chosen AND named by the address is current, not chosen
  assert.equal(V.rangee({ href: "#/decision/b", cle: "b", courant: true, choisie: false, html: "" }).includes("choisie"), false);
  assert.equal(V.liste(r, "Vos applications"), `<nav aria-label="Vos applications"><div class="rows" data-liste>${r}</div></nav>`);
});

test("previous and next: links to their address, a still mark where there is none, its place said", () => {
  const W = { prev: "Application précédente", next: "Application suivante", pos: (i, n) => `${i} / ${n}`, posLabel: (i, n) => `application ${i} sur ${n}` };
  const first = V.pas({ i: 1, n: 3, avant: null, apres: "#/decision/b", mots: W });
  assert.match(first, /^<span class="pas"><span class="pas-b" aria-hidden="true">/);
  assert.match(first, /<span class="pas-n" aria-label="application 1 sur 3">1 \/ 3<\/span><a class="pas-b" href="#\/decision\/b" aria-label="Application suivante" data-focus-key="pas:1">/);
  const mid = V.pas({ i: 2, n: 3, avant: "#/decision/a", apres: "#/decision/c", mots: W });
  assert.equal((mid.match(/<a class="pas-b"/g) ?? []).length, 2);
});

test("the head of a detail, a sheet, a fold, a state: the screen's heading where nothing else names it", () => {
  assert.equal(V.entete({ meta: "M", titre: "T", phrase: "P", actions: "A", pas: "S" }), '<header class="d-head"><div class="d-meta">MS</div><h1 tabindex="-1">T</h1><p class="phrase">P</p><div class="d-act">A</div></header>');
  assert.equal(V.pli({ cle: "verifier", titre: "V", corps: "C", id: "verifier" }), '<details class="pli" data-pli="verifier" id="verifier"><summary data-focus-key="pli:verifier">V</summary><div class="pli-b">C</div></details>');
  assert.match(V.etat({ titre: "Rien", h1: true }), /<h1 tabindex="-1">Rien<\/h1>/);
  assert.match(V.etat({ titre: "Rien" }), /<h2>Rien<\/h2>/);
  // the skeleton: no number, no word but its label, said to assistive technologies
  const sk = V.squelette(4, "Lecture de vos applications");
  assert.equal((sk.match(/class="sk-row"/g) ?? []).length, 4);
  assert.equal(/\d/.test(sk.replace(/<[^>]+>/g, "")), false);
  assert.match(sk, /role="status">Lecture de vos applications<\/p>/);
});

test("a repaint keeps what the member was on: the list's scroll on the same screen, the detail's scroll and folds on the same item, the focus by its key", () => {
  S.volets = null; S.focusKey = null;
  V.rendre(V.garder(), { cle: "applications", sel: "a", ecran: "liste" });
  page.liste.scrollTop = 420; page.detail.scrollTop = 900; page.detail.folds.set("verifier", true); page.detail.folds.set("niveau", false);
  page.active = { dataset: { focusKey: "row:a" } };
  // the same screen, the same item (a live update, a switch of language): everything comes back
  let memo = V.garder();
  assert.equal(S.focusKey, "row:a", "the focus's key is kept for the shell, which focuses it again");
  assert.deepEqual([memo.liste, memo.detail, memo.plis], [420, 900, ["verifier"]]);
  page.liste.scrollTop = 0; page.detail.scrollTop = 0; page.detail.folds.set("verifier", false);
  V.rendre(memo, { cle: "applications", sel: "a", ecran: "liste" });
  assert.deepEqual([page.liste.scrollTop, page.detail.scrollTop, page.detail.folds.get("verifier")], [420, 900, true]);
  // another item on the same screen: the list keeps its scroll, the detail starts at its top with its folds closed
  page.liste.scrollTop = 420; page.detail.scrollTop = 900; S.focusKey = null; page.active = null;
  memo = V.garder();
  page.liste.scrollTop = 0; page.detail.scrollTop = 0; page.detail.folds.set("verifier", false);
  V.rendre(memo, { cle: "applications", sel: "b", ecran: "detail" });
  assert.deepEqual([page.liste.scrollTop, page.detail.scrollTop, page.detail.folds.get("verifier")], [420, 0, false]);
  // another screen: nothing is carried over (planted control: the same memo on the same screen would restore)
  page.liste.scrollTop = 300; memo = V.garder(); page.liste.scrollTop = 0;
  V.rendre(memo, { cle: "journal", sel: "1", ecran: "liste" });
  assert.equal(page.liste.scrollTop, 0);
  assert.deepEqual(S.volets, { cle: "journal", sel: "1", ecran: "liste" });
});
