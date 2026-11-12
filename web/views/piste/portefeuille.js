// « La piste » (ADR-0035): the portfolio as rails. One row per application under one shared header of the six steps:
// its name and state, its rail, ONE plain sentence and its action. The applications the index carries come first, in
// the order of runward-fleet's reading (refused first, then the level not met, then the others, each in the
// inventory's order: `decide(index).listing.ids`); then the declared ones whose first check is awaited, to confirm
// first. Above, the sentence that says the whole portfolio; below, folded, runward-fleet's own reading of the
// portfolio, byte for byte (its five state tiles and its list), as the raw detail.
import { esc } from "../base.js";
import { when } from "../time.js";
import { go, mk } from "../marks.js";
import { decide } from "../fleet-views.js";
import { prochainPas } from "../liens.js";
import { piste } from "./mots.js";
import { rail, heads, chip, stepName, pieceName, kindsSentence } from "./rail.js";
import { stations, synthesis, verdictOf } from "./donnees.js";

/** A repository's name without its owner (« owner/name » → « name »), as the sidebar says it. */
const sansOwner = (n) => { const t = String(n ?? ""); return t.slice(t.indexOf("/") + 1); };
export const shortName = (m) => (m.path && m.path !== "." ? m.path.split("/").pop() : sansOwner(m.name ?? m.id));
const repoShort = (l) => `${sansOwner(l.repository)}${l.path && l.path !== "." ? ` · ${l.path}` : ""}`;

/** The one sentence of an application of the index, HTML-safe. */
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

/** The sentence that says the whole portfolio (text), then when it was updated (HTML: a <time>). */
export function synth(index, status) {
  const P = piste().synth, c = synthesis(index, status.lines, prochainPas);
  const parts = [c.gaps && P.gaps(c.gaps), c.level && P.level(c.level), c.clean && P.clean(c.clean), c.confirm && P.confirm(c.confirm), c.silent && P.silent(c.silent)].filter(Boolean);
  return { said: `${P.apps(c.total)}${parts.length ? `${P.sep}${parts.join(", ")}` : ""}.`, at: status.index ? P.updated(when(status.index.publishedAt, { sec: false })) : "" };
}

/**
 * The portfolio: `index` and `status` as served, `waiting` the status lines the index does not carry yet, `w` the
 * decision reading's own words (decision.js), `reasons` the service's words for a refusal's code, `bouge` the steps a
 * live check moved and `neuf` the applications a live read brought, by application; `avant` what stands between the
 * title and the board (the first-run rail). Returns the body of the screen under its title.
 */
export function portfolio({ index, status, waiting, w, reasons, bouge = {}, neuf = {}, avant = "" }) {
  const P = piste();
  const missions = index?.missions ?? [];
  const order = missions.length ? decide(index).listing.ids : [];
  const byId = new Map(missions.map((m) => [m.id, m]));
  const lineOf = (id) => status.lines.find((l) => l.mission === id) ?? null;
  const rows = order.map((id) => byId.get(id)).filter(Boolean).map((m) => {
    const name = shortName(m), href = `#/decision/${encodeURIComponent(m.id)}`, v = verdictOf(m);
    return `<li class="pi-rg r-${esc(v)}${neuf[m.id] ? " neuf" : ""}" data-mission="${esc(m.id)}"><div class="pi-qui"><a class="pi-nm" href="${esc(href)}" translate="no">${esc(name)}</a>${chip(v)}</div>
      ${rail(m, name, { bouge: bouge[m.id] ?? [] })}
      <div class="pi-dit"><p>${rowSentence(m, lineOf(m.id), reasons)}</p><a class="lien" href="${esc(href)}">${esc(P.read)}</a></div></li>`;
  });
  // the declared applications, their first check awaited: to confirm first, then the others
  const rank = (l) => { const k = prochainPas(l).kind; return k === "confirm" || k === "owner" ? 0 : 1; };
  const awaited = [...waiting].sort((a, b) => rank(a) - rank(b)).map((l) => {
    const n = prochainPas(l), N = w.next, name = repoShort(l);
    // the deadline of a declaration nothing reached yet, when the status carries it (an additive field of the
    // common lot of « la piste », ADR-0034: absent, the sentence is said without it)
    const due = n.kind === "install" && l.expiresAt ? ` ${P.row.expires(when(l.expiresAt, { sec: false }))}` : "";
    const said = `${n.kind === "confirm" ? N.confirm(when(n.at, { sec: false })) : esc(N[n.kind])}${due}`;
    const state = n.kind === "confirm" || n.kind === "owner" ? mk("half", P.toConfirm) : chip("not-observed");
    return `<li class="pi-rg r-attente" data-mission="${esc(l.mission)}"><div class="pi-qui"><span class="pi-nm" translate="no">${esc(name)}</span>${state}</div>
      ${rail({ id: l.mission, latest: "not-observed" }, name)}
      <div class="pi-dit"><p>${said}</p>${go(n.href, N[`${n.kind}Act`], { q: n.kind === "install" || n.kind === "wait" })}</div></li>`;
  });
  const s = synth(index, status);
  return `<div class="tete pi-tete"><h1 class="t1">${esc(w.title)}</h1><p class="synthese">${esc(s.said)}${s.at ? `<span class="soft">${s.at}</span>` : ""}</p></div>${avant}
    <section class="scr verre pi-fen pi-bd" aria-label="${esc(P.board)}"><h2 class="scr-bar">${esc(P.board)}</h2><div class="scr-body">${heads()}<ol class="pi-board">${[...rows, ...awaited].join("")}</ol></div></section>`;
}
