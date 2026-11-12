// « La piste » (ADR-0035) in the list pane of the fixed shell (ADR-0036): the applications as a compact list. Each row
// says its name, its state by the reading's own mark and word, its six stations in small, ONE short reason and the time
// its check was received; the window's bar says the whole portfolio, its counts by state as filters, and when it was
// last read. The applications the index carries come first, in the order of runward-fleet's reading (refused first,
// then the level not met, then the others, each in the inventory's order: `decide(index).listing.ids`); then the
// declared ones whose first check is awaited, to confirm first. Every value is escaped here or by its caller.
import { esc } from "../base.js";
import { when, hm } from "../time.js";
import { mk } from "../marks.js";
import { mots } from "../lexique.js";
import { decide } from "../fleet-views.js";
import { prochainPas } from "../liens.js";
import { piste } from "./mots.js";
import { chip, stepName, pieceName, kindsSentence, stateWord } from "./rail.js";
import { stations, verdictOf, passed, versPasse } from "./donnees.js";
import { barre, rangee, liste, tete, etat } from "../volets.js";

/** A repository's name without its owner (« owner/name » → « name »), as the sidebar says it. */
const sansOwner = (n) => { const t = String(n ?? ""); return t.slice(t.indexOf("/") + 1); };
export const shortName = (m) => (m.path && m.path !== "." ? m.path.split("/").pop() : sansOwner(m.name ?? m.id));
const repoShort = (l) => `${sansOwner(l.repository)}${l.path && l.path !== "." ? ` · ${l.path}` : ""}`;

/** The one sentence of an application of the index, HTML-safe (the head of its reading). */
export function rowSentence(m, line, reasons) {
  const R = piste().row, v = verdictOf(m), st = stations(m);
  if (v === "gaps") {
    const head = st.stop ? R.stopped(st.stop, stepName(st.stations[st.stop - 1].id)) : R.refusedNoStep;
    const k = kindsSentence(m);
    if (k) return `${esc(head)} ${k}`;
    const missing = st.stations.flatMap((x) => x.missing);
    return missing.length ? `${esc(head)} ${R.missing(missing.length, missing.map(pieceName).join(", "))}` : esc(head);
  }
  if (v === "clean") return esc(`${R.allPass}${st.rows ? ` ${R.rows(st.rows.total)}` : ""}`);
  if (v === "level-not-met") return esc(R.level);
  if (line?.lastRefusal) return `${esc(R.silent)} ${R.lastRefused(reasons(line.lastRefusal))}`;
  return esc(R.silent);
}

// ------------------------------------------------------------- the entries of the list
/**
 * The applications in the list's order: { id, name, m, line } for one the index carries, { id, name, line, next } for
 * one declared whose first check is awaited. `waiting` are the status lines the index does not carry.
 */
export function entrees(index, status, waiting) {
  const missions = index?.missions ?? [];
  const order = missions.length ? decide(index).listing.ids : [];
  const byId = new Map(missions.map((m) => [m.id, m]));
  const lineOf = (id) => status?.lines?.find((l) => l.mission === id) ?? null;
  const published = order.map((id) => byId.get(id)).filter(Boolean).map((m) => ({ id: m.id, name: shortName(m), m, line: lineOf(m.id) }));
  const rank = (l) => { const k = prochainPas(l).kind; return k === "confirm" || k === "owner" ? 0 : 1; };
  const awaited = [...waiting].sort((a, b) => rank(a) - rank(b)).map((l) => ({ id: l.mission, name: repoShort(l), line: l, next: prochainPas(l) }));
  return [...published, ...awaited];
}
/** The filter an entry falls in: refused, level not met, nothing blocking, to confirm, no check received. */
export function categorie(e) {
  if (e.m) { const v = verdictOf(e.m); return v === "gaps" ? "gaps" : v === "level-not-met" ? "level" : v === "clean" ? "clean" : "silent"; }
  return e.next.kind === "confirm" || e.next.kind === "owner" ? "confirm" : "silent";
}
/** The counts by filter, in the order the bar says them. */
export function comptes(list) {
  const c = { gaps: 0, level: 0, clean: 0, confirm: 0, silent: 0 };
  for (const e of list) c[categorie(e)]++;
  return c;
}
const STATE = { gaps: "gaps", level: "level-not-met", clean: "clean", silent: "not-observed" };

/** The mark of an entry, its shape then its hue (web/app.css), never the hue alone. */
const markOf = (e) => (categorie(e) === "confirm" ? '<span class="mk mk-half" aria-hidden="true"></span>' : `<span class="etq" data-state="${esc(STATE[categorie(e)])}"><span data-role="mark" aria-hidden="true"></span></span>`);
/** The state's word of an entry, as runward-fleet's reading says it (to confirm: the app's word). */
const wordOf = (e) => (categorie(e) === "confirm" ? piste().toConfirm : stateWord(e.m ? verdictOf(e.m) : "not-observed"));
/** The time of an entry: when its check in force was received, or its first upload that waits. */
export const timeOf = (e) => (e.m ? e.line?.accepted?.receivedAt ?? null : e.next.at ?? null);

/**
 * The six stations in small: where the line stops, the refused mark where the check refuses, the passing green on the
 * stations the version passed and on the line when it runs to the end (ADR-0038).
 */
export function mini(e) {
  const st = stations(e.m ?? { id: e.id, latest: "not-observed" });
  const pct = Math.round(st.reach * 1000) / 10;
  return `<span class="mini${st.verdict === "not-observed" || st.verdict === "not-available" ? " vide" : ""}${st.verdict === "clean" ? " passe" : ""}" aria-hidden="true"><span class="mini-f" style="width:${pct}%"></span>${st.stations.map((x) => `<i class="m-${passed(st, x) ? "passe" : x.state}"></i>`).join("")}</span>`;
}

/** The short reason of a row (HTML-safe): where it stops and how many refusals, or what it waits for. */
export function raison(e, w) {
  const C = mots().coque.row, R = piste().row;
  if (!e.m) return e.next.kind === "confirm" ? w.next.confirm(when(e.next.at, { sec: false })) : esc(w.next[e.next.kind]);
  const v = verdictOf(e.m), st = stations(e.m);
  if (v === "gaps") {
    const k = st.stations.reduce((a, x) => a + x.refusals.length, 0) + st.unplaced.length, miss = st.stations.reduce((a, x) => a + x.missing.length, 0);
    return esc(st.stop ? C.stopped(st.stop, stepName(st.stations[st.stop - 1].id), k, miss) : C.refused(k));
  }
  if (v === "clean") return esc(`${R.allPass}${st.rows ? ` ${R.rows(st.rows.total)}` : ""}`);
  if (v === "level-not-met") return esc(R.level);
  return esc(R.silent);
}

// ------------------------------------------------------------- the window's bar
/**
 * The bar: how many applications, their counts by state as filters (`filtre` the one kept), the sentence that says
 * the same on a phone, and when the index was last published (the live dot, or the offline one).
 */
export function barreApps(list, status, filtre) {
  const C = mots().coque, P = piste().synth, c = comptes(list);
  const chips = [["gaps", c.gaps > 1 ? C.chips.gapsMany : C.chips.gaps], ["level", C.chips.level], ["clean", C.chips.clean], ["confirm", C.chips.confirm], ["silent", C.chips.silent]]
    .filter(([k]) => c[k]).map(([k, word]) => {
      const m = k === "confirm" ? '<span class="mk mk-half" aria-hidden="true"></span>' : `<span class="etq" data-state="${STATE[k]}"><span data-role="mark" aria-hidden="true"></span></span>`;
      return `<button class="chip" type="button" data-do="filtre" data-k="${k}" data-focus-key="filtre:${k}" aria-pressed="${filtre === k}">${m}<b class="num">${c[k]}</b><span>${esc(word)}</span></button>`;
    }).join("");
  const parts = [c.gaps && P.gaps(c.gaps), c.level && P.level(c.level), c.clean && P.clean(c.clean), c.confirm && P.confirm(c.confirm), c.silent && P.silent(c.silent)].filter(Boolean);
  const at = status?.index?.publishedAt;
  const hors = typeof navigator === "object" && navigator.onLine === false;
  const direct = at ? `<p class="direct${hors ? " perime" : ""}"><i aria-hidden="true"></i><span aria-hidden="true">${hors ? C.stale(hm(at)) : C.updated(hm(at))}</span><span class="vh">${hors ? C.stale(when(at, { sec: false })) : P.updated(when(at, { sec: false }))}</span></p>` : "";
  return barre({
    titre: esc(C.apps(list.length)),
    synth: esc(`${P.apps(list.length)}${parts.length ? `${P.sep}${parts.join(", ")}` : ""}.`),
    filtres: chips ? `<div class="filtres" role="group" aria-label="${esc(C.filters)}">${chips}</div>` : "",
    direct,
  });
}

// ------------------------------------------------------------- the list pane
/**
 * The list pane: « À faire » first when something waits (`afaire`, its compact strip), then the rows. `sel` the id the
 * address names, `choisie` the one shown by default on a desk, `filtre` the filter kept, `bouge` what a live read moved
 * (donnees.js#moved, its mark in the passing green when it moved toward passing) and `neuf` the applications it
 * brought, by id; `detail` runward-fleet's reading of the portfolio, folded last.
 */
export function listeApps(list, { w, sel = null, choisie = null, filtre = null, bouge = {}, neuf = {}, afaire = "", detail = "" }) {
  const C = mots().coque, V = piste().vif;
  const shown = list.filter((e) => !filtre || categorie(e) === filtre);
  const rows = shown.map((e) => {
    const t = timeOf(e);
    const moved = bouge[e.id] ? `<span class="r-bouge"${versPasse(bouge[e.id]) ? ' data-sens="passe"' : ""}>${esc(V.badge)}</span>` : "";
    return rangee({
      href: `#/decision/${encodeURIComponent(e.id)}`, cle: e.id, courant: sel === e.id, choisie: !sel && choisie === e.id, cls: neuf[e.id] ? "neuf" : "",
      html: `<span class="r-mk">${markOf(e)}</span><span class="r-nm"><span translate="no">${esc(e.name)}</span>${moved}</span><span class="r-t">${t ? hm(t) : ""}</span>
        <span class="r-st"${categorie(e) === "clean" ? ' data-state="clean"' : ""}>${esc(wordOf(e))}</span>${mini(e)}<span class="r-why">${raison(e, w)}</span>`,
    });
  }).join("");
  const vide = shown.length ? "" : etat({ texte: esc(C.states.noneInFilter), actions: `<button class="btn btn-q" type="button" data-do="filtre" data-k="" data-focus-key="filtre:">${esc(C.allApps)}</button>` });
  // runward-fleet's own reading of the portfolio, byte for byte, folded at the end of the list (ADR-0035)
  const brut = detail ? `<details class="pi-pli l-brut" data-pli="detail-port"><summary>${esc(piste().detail.portfolio)}</summary><div class="pi-pli-b">${detail}</div></details>` : "";
  return `${afaire}${tete(esc(C.listLabel), esc(C.sortNote))}${liste(rows, C.listLabel)}${vide}${brut}`;
}

/** The state of an entry as the head of its reading says it (HTML). */
export const etatTete = (e) => (categorie(e) === "confirm" ? mk("half", piste().toConfirm) : chip(e.m ? verdictOf(e.m) : "not-observed"));
