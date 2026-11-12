// « La piste » (ADR-0035), read in the detail pane of the fixed shell (ADR-0036): one application's reading. Its head
// stays in view while the pane scrolls (its state, when its check was received, the run, the commit, the previous and
// the next application); then its rail in large, each station a button that keeps only what blocks there; « Ce qui
// bloque » as a table grouped by step (file, line, requirement, the status a row proposes; the check's text as written
// behind a fold); the required documents step by step; beside them « Ce qui s'est passé » from what the check and the
// service recorded and nothing else, the checked deliveries as a timeline; then, folded, « Vérifier par vous-même »
// (decision.js, its strict patterns unchanged), the path the file took (ADR-0029) and runward-fleet's own reading of
// the application, byte for byte, as the raw detail. Every value is escaped here or by its caller.
import { esc } from "../base.js";
import { when } from "../time.js";
import { mots } from "../lexique.js";
import { piste } from "./mots.js";
import { rail, chip, stepName, pieceName, flx, stateWord, firstRail } from "./rail.js";
import { ETAPES, stations, blockTable, renamed, history, verdictOf } from "./donnees.js";
import { rowSentence, shortName } from "./portefeuille.js";
import { entete, corps, colonnes, feuille, pli, pas } from "../volets.js";

const dot = (s) => `<span class="pi-mk pi-mk-${s}" aria-hidden="true"></span>`;
const short = (c) => esc(String(c ?? "").slice(0, 7));

/** The words of a list of steps: « l'étape 3, Plancher et l'étape 5, Gouverner ». */
export function stepsSaid(ids) {
  const T = piste().told;
  const said = [...new Set(ids.filter(Boolean))].sort((a, b) => ETAPES.indexOf(a) - ETAPES.indexOf(b)).map((id) => T.step(ETAPES.indexOf(id) + 1, stepName(id)));
  return said.length > 1 ? `${said.slice(0, -1).join(", ")}${T.and}${said.at(-1)}` : said[0] ?? "";
}

// ------------------------------------------------------------- « Ce qui bloque », as a table
/** One group of the table: a step and a kind, every place it stands for, the cited name no longer found, the check's text folded. */
function group(t) {
  const B = piste().blocks, C = mots().coque.blocks;
  const head = t.step ? `${ETAPES.indexOf(t.step) + 1}. ${esc(stepName(t.step))}` : esc(B.unplaced);
  const kind = flx().kind?.[t.kind] ?? t.kind ?? "";
  const st = t.places.some((p) => p.status);
  const cols = `<div class="lieu lieux-h${st ? " st4" : ""}" aria-hidden="true"><span>${esc(C.cols[0])}</span><span class="ln">${esc(C.cols[1])}</span><span class="rg">${esc(C.cols[2])}</span>${st ? `<span class="statut">${esc(C.status)}</span>` : ""}</div>`;
  const place = (p) => `<li class="lieu${st ? " st4" : ""}"><code translate="no">${esc(p.file ?? "")}</code><span class="ln">${p.line ? esc(p.line) : esc(C.noLine)}</span><span class="rg">${p.rule ? `<span class="vh">${esc(B.rule)} </span><code translate="no">${esc(p.rule)}</code>` : ""}</span>${st ? `<span class="statut">${p.status ? `<span class="vh">${esc(C.status)} </span><code translate="no">${esc(p.status)}</code>` : ""}</span>` : ""}</li>`;
  const cites = [...new Map(t.problems.map(renamed).filter(Boolean).map((r) => [r.pointer, r])).values()]
    .map((r) => `<div class="pi-diff"><p><span class="d-k">${esc(B.cites)}</span><code translate="no">${esc(r.pointer.slice(0, r.pointer.length - r.symbol.length))}<del>${esc(r.symbol)}</del></code></p><p class="d-s">${esc(B.notFound)}</p></div>`).join("");
  const text = t.problems.length ? `<details class="pi-tel"><summary>${esc(B.asWritten)}</summary>${t.problems.map((p) => `<p class="pi-verb" lang="en" translate="no">${esc(p)}</p>`).join("")}</details>` : "";
  return `<div class="grp"><p class="grp-h">${dot("refus")}<span><b>${head}</b> · ${esc(kind)}</span><span class="n">${esc(C.lines(t.places.length))}</span></p>
    <ul class="lieux" role="list">${cols}${t.places.map(place).join("")}</ul>${cites}${text}</div>`;
}
/** A required document missing at a step, as a group of one line. */
function missingGroup(x, d) {
  const B = piste().blocks, C = mots().coque.blocks;
  return `<div class="grp"><p class="grp-h">${dot("refus")}<span><b>${x.n}. ${esc(stepName(x.id))}</b> · ${B.piece(pieceName(d), esc(flx().pieces.state?.[d.state] ?? d.state))}</span><span class="n">${esc(C.lines(1))}</span></p>
    <ul class="lieux" role="list"><li class="lieu"><code translate="no">${esc(d.relPath ?? "")}</code><span class="ln">${esc(C.noLine)}</span><span class="rg">${esc(C.missing)}</span></li></ul></div>`;
}
/** What blocks, for the whole application (n = 0) or at one station (n = 1 to 6): the table, or what stands instead of it. */
function blocksPanel(m, n) {
  const B = piste().blocks, A = piste().app, st = stations(m), v = st.verdict;
  if (v === "clean") return `<p class="pi-pan-t">${dot("ok")}<span>${esc(B.none)}</span></p>`;
  if (v === "level-not-met") return `<p class="pi-pan-t">${dot("ok")}<span>${esc(B.level)}</span></p>`;
  if (v !== "gaps") return `<p class="pi-pan-t">${dot("attente")}<span>${esc(B.silent)}</span></p>`;
  const only = n ? ETAPES[n - 1] : null;
  const rows = blockTable(st, only);
  const missing = st.stations.filter((x) => !only || x.id === only).flatMap((x) => x.missing.map((d) => missingGroup(x, d)));
  const count = rows.reduce((a, g) => a + g.places.length, 0) + missing.length;
  const gate = !only && st.gateOnly.length ? `<p class="pi-pan-n">${esc(B.gateOnly(stepsSaid(st.gateOnly)))}</p>` : "";
  if (!count) return `${gate}<p class="pi-pan-t">${dot(only ? "ok" : "refus")}<span>${esc(only ? A.stepNothing : B.title)}</span></p>`;
  return `${gate}<p class="vh">${esc(B.lead(count))}</p>${[...rows.map(group), ...missing].join("")}`;
}
function blocksSheet(m, sel) {
  const A = piste().app, B = piste().blocks, C = mots().coque.blocks, st = stations(m);
  const refus = st.stations.reduce((a, x) => a + x.refusals.length, 0) + st.unplaced.length, miss = st.stations.reduce((a, x) => a + x.missing.length, 0);
  const said = [refus ? A.sub.refus(refus) : "", miss ? A.sub.missing(miss) : ""].filter(Boolean).join(", ");
  const panels = [0, 1, 2, 3, 4, 5, 6].map((n) => `<div class="pi-pan" id="pi-pan-${n}"${(sel ?? 0) === n ? "" : " hidden"}>${n ? `<p class="tag-f"><span>${esc(C.onlyStep(n, stepName(ETAPES[n - 1])))}</span><button class="lien" type="button" data-pi-station="${n}">${esc(C.all)}</button></p>` : ""}${blocksPanel(m, n)}</div>`).join("");
  const choose = st.verdict === "gaps" ? `<p class="sh-n">${esc(A.choose)}</p>` : "";
  return feuille({ titre: `${esc(B.title)}${said ? ` <span class="soft">· ${esc(said)}</span>` : ""}`, sous: choose, corps: `<div class="pi-pans">${panels}</div>`, id: "ce-qui-bloque", cls: "blocs" });
}

// ------------------------------------------------------------- the required documents, step by step
function piecesSheet(m, sel) {
  const C = mots().coque.pieces, st = stations(m);
  const docs = st.stations.flatMap((x) => x.pieces);
  const filled = docs.filter((d) => d.state === "filled").length;
  const rows = st.stations.map((x) => {
    const on = sel === x.n ? " sel" : "";
    const step = `<span class="et">${x.n}. ${esc(stepName(x.id))}</span>`;
    if (!x.pieces.length) return `<li class="pc${on}" data-pc="${x.n}">${step}<span class="ps soft">${dot("vide")}${esc(C.none)}</span><span class="ex"></span></li>`;
    return x.pieces.map((d, i) => `<li class="pc${on}${i ? " cont" : ""}" data-pc="${x.n}">${step}<span class="ps">${dot(d.state === "filled" ? "ok" : "refus")}<span>${pieceName(d)}${d.state === "filled" ? "" : ` <span class="soft">· ${esc(flx().pieces.state?.[d.state] ?? d.state)}</span>`}</span></span><span class="ex">${i === 0 && x.rows ? esc(piste().app.sub.rows(x.rows)) : ""}</span></li>`).join("");
  }).join("");
  return feuille({ titre: esc(C.title), sous: docs.length ? `<p class="sh-n">${esc(C.lead(filled, docs.length))}</p>` : "", corps: `<ol class="pieces" role="list">${rows}</ol>` });
}

/** « Ce qui s'est passé »: what the check and the service recorded, in order. HTML-safe. */
function told(m, line) {
  const T = piste().told, st = stations(m), L = m.latest, a = line?.accepted;
  if (!a || typeof L !== "object" || !L) return "";
  const items = [];
  items.push([dot("ok"), T.delivered(when(a.receivedAt, { sec: false }), a.commit ? `<code translate="no">${short(a.commit)}</code>` : "", a.runNumber ? esc(a.runNumber) : "", a.workflow ? `<code translate="no">${esc(a.workflow)}</code>` : "")]);
  const docs = Array.isArray(L.deliverables?.list) ? L.deliverables.list : [];
  if (docs.length) items.push([dot("ok"), esc(T.read(L.runward ?? "", docs.filter((d) => d.state === "filled").length, docs.length, st.rows ? st.rows.total : 0))]);
  const red = st.stations.filter((x) => x.state === "refus").map((x) => x.id);
  const nRef = Array.isArray(L.conformance) ? L.conformance.length : 0;
  if (st.verdict === "gaps") items.push([dot("refus"), esc(nRef ? T.refusedAt(stepsSaid(red), nRef) : T.refusedGate(stepsSaid(red)))]);
  else if (st.verdict === "level-not-met") items.push([dot("ok"), esc(T.level)]);
  else items.push([dot("ok"), esc(T.nothing)]);
  const conf = (line?.activity ?? []).find((e) => e.what === "repository-confirmed");
  if (conf) items.push([dot("ok"), T.confirmed(when(conf.at, { sec: false }))]);
  return feuille({ titre: esc(T.title), cls: "pi-recit-f", corps: `<div class="sh-b"><p class="note">${esc(T.lead)}</p><ol class="pi-recit">${items.map(([d, t]) => `<li>${d}<p>${t}</p></li>`).join("")}</ol></div>` });
}

/** The checked deliveries, most recent first: the status's acts of this application. `reasonOf` says a refusal's code. */
export function timeline(m, line, { reasonOf, received, fresh }) {
  const H = piste().hist, v = verdictOf(m);
  const items = history(line).map((e) => {
    const word = e.current ? `${esc(e.what === "repository-confirmed" ? H.confirmed : received.what["send-accepted"])}, ${esc(H.current(stateWord(v)))}`
      : e.what === "send-accepted" || e.what === "send-historical" ? esc(H.earlier)
      : e.what === "send-pending" ? esc(line?.state === "pending" ? H.pending : H.received) : e.what === "repository-confirmed" ? esc(H.confirmed)
      : e.what === "send-quarantined" ? esc(H.setAside) : e.what === "send-not-accepted" ? esc(H.notAccepted) : esc(e.what);
    const mark = e.current ? `<span class="pi-mk-etat" data-state="${esc(v)}"><span data-role="mark" aria-hidden="true"></span></span>` : dot(e.what === "send-not-accepted" || e.what === "send-quarantined" ? "attente" : e.what === "send-pending" && line?.state === "pending" ? "ici" : "ok");
    const meta = [e.commit ? `commit <code translate="no">${short(e.commit)}</code>` : "", e.runNumber ? (e.forge === "gitlab" ? `pipeline ${esc(e.runNumber)}` : esc(H.run(e.runNumber))) : ""].filter(Boolean).join(" · ");
    return `<li${e.current && fresh ? ' class="neuf"' : ""}>${mark}<span class="num">${when(e.at, { sec: false })}</span><span>${word}${e.refusal ? reasonOf(e.refusal) : ""}</span>${meta ? `<span class="soft small">${meta}</span>` : ""}</li>`;
  }).join("");
  const since = line?.notAcceptedSince ? `<p>${received.since(line.notAcceptedSince)}</p>` : "";
  const earlier = history(line).some((e) => !e.current && (e.what === "send-accepted" || e.what === "send-historical" || e.what === "repository-confirmed"));
  return feuille({ titre: esc(H.title), cls: "pi-hist-f", corps: `<div class="sh-b">${items ? `<ol class="pi-hist">${items}</ol>` : `<p class="note">${esc(H.none)}</p>`}${since}
    ${earlier ? `<p class="note">${esc(H.verdictKept)}</p>` : ""}<p class="note"><a class="lien" href="#/envois">${esc(H.journal)}</a></p></div>` });
}

/** What moved, when a live read brought a new check of this application (vif.js). HTML-safe. */
export function movedSection(d) {
  if (!d) return "";
  const V = piste().vif;
  const lines = [];
  if (d.verdict) lines.push(esc(V.verdict(stateWord(d.verdict[0]), stateWord(d.verdict[1]))));
  for (const [k, f] of [["lifted", V.lifted], ["raised", V.raised], ["filled", V.filled], ["emptied", V.emptied], ["decided", V.decided]]) if (d[k].length) lines.push(esc(f(d[k].length, stepsSaid(d[k]))));
  if (!lines.length) lines.push(esc(V.same));
  return feuille({ titre: esc(V.moved), cls: "pi-bouge-f neuf", corps: `<div class="sh-b" role="status"><ul class="pi-recit">${lines.map((t) => `<li>${dot("ok")}<p>${t}</p></li>`).join("")}</ul><p class="note">${esc(V.movedLead)}</p></div>` });
}

/** The meta line of a head: when the check in force was received, its run, its commit. HTML-safe. */
const metaOf = (line) => { const a = line?.accepted; return a ? piste().app.meta(when(a.receivedAt, { sec: false }), a.runNumber ? esc(a.runNumber) : "", a.commit ? `<code translate="no">${short(a.commit)}</code>` : "") : ""; };

/**
 * The reading of one application in the detail pane. `m` the index's mission, `line` its status line, `sel` the
 * station kept (or null), `verify` and `level` the bodies of « Vérifier par vous-même » and of the path the file took
 * (decision.js), `detail` runward-fleet's reading, `ctx` what the timeline needs, `bouge` what a live read moved,
 * `premier` true right after the first check was confirmed, `pos` its place in the list ({ i, n, avant, apres }),
 * `avant` what stands first in the body (a notice of the service).
 */
export function reading(m, line, { sel = null, verify, level, detail, ctx, bouge = null, premier = false, pos, avant = "" }) {
  const P = piste(), A = P.app, C = mots().coque, st = stations(m), v = st.verdict;
  const name = shortName(m);
  const meta = metaOf(line);
  const title = v === "gaps" ? A.refused : v === "clean" ? A.clean : v === "level-not-met" ? A.level : A.silent;
  const first = premier ? `<p class="pi-premier" role="status">${dot("ok")}<span>${esc(P.first.verdict(name))}</span></p>` : "";
  const head = entete({
    meta: `${chip(v)}${meta ? `<span class="soft">${meta}</span>` : ""}`,
    titre: `<span translate="no">${esc(name)}</span> · ${esc(title)}`,
    phrase: `${rowSentence(m, line, ctx.reasonText)}${v === "gaps" || v === "clean" ? ` ${esc(A.decision)}` : ""}`,
    actions: `<button class="btn btn-q" type="button" data-do="verifier" data-focus-key="verifier">${esc(ctx.verifyTitle)}</button>`,
    pas: pos ? pas({ ...pos, mots: C }) : "",
  });
  const railSheet = feuille({ titre: esc(A.rail), corps: rail(m, name, { grand: true, sel, bouge: bouge?.steps ?? [], id: "pi-grand" }), cls: "pi-lect" });
  const side = [
    told(m, line),
    timeline(m, line, { ...ctx, fresh: Boolean(bouge) }),
    pli({ cle: "verifier", id: "verifier", titre: esc(ctx.verifyTitle), corps: verify }),
    level ? pli({ cle: "niveau", titre: esc(mots().forge.level.h2), corps: `<div class="lecture-niveau">${level}</div>` }) : "",
    pli({ cle: "detail-app", titre: esc(P.detail.app), corps: `<div class="lecture-detail">${detail}</div>` }),
  ].join("");
  return `${head}${corps(`${avant}${first}${movedSection(bouge)}${railSheet}${colonnes(`${blocksSheet(m, sel)}${piecesSheet(m, sel)}`, side)}`)}`;
}

/**
 * The reading of an application whose first check is awaited: where it stands among the five gestures, what waits and
 * its button, its deliveries so far. `next` is its next step (liens.js#prochainPas), `said` its sentence (HTML-safe),
 * `act` the button to that step, `todo` the item of « À faire » that names it, if any.
 */
export function awaited({ name, state, next, said, act, cur, todo, line, ctx, pos }) {
  const C = mots().coque, F = P_first();
  const head = entete({ meta: state, titre: `<span translate="no">${esc(name)}</span> · ${esc(next.kind === "confirm" || next.kind === "owner" ? piste().toConfirm : piste().app.silent)}`, phrase: said, actions: act, pas: pos ? pas({ ...pos, mots: C }) : "" });
  const firstSheet = feuille({ titre: esc(F.rail), corps: firstRail(cur), cls: "pi-lect" });
  const waits = todo ? feuille({ titre: esc(C.waits), corps: `<div class="sh-b attend">${todo}</div>` }) : "";
  return `${head}${corps(`${firstSheet}${waits}${timeline({ latest: "not-observed" }, line, { ...ctx, fresh: false })}`)}`;
}
const P_first = () => piste().first;
