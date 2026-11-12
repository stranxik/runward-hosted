// « La piste » (ADR-0035): one application's reading. Its rail in large, each station a button that opens its
// documents and what blocks there; « Ce qui bloque » with the exact lines (file and line, from the index); « Ce qui
// s'est passé » from what the check and the service recorded, and nothing else (no story the index does not carry);
// « Vérifier par vous-même » (decision.js, its strict patterns unchanged); the checked deliveries as a timeline (the
// status's activity); then, folded, runward-fleet's own reading of the application, byte for byte, as the raw detail.
import { esc } from "../base.js";
import { when } from "../time.js";
import { piste } from "./mots.js";
import { rail, chip, stepName, pieceName, flx, stateWord } from "./rail.js";
import { stations, blockGroups, renamed, history, verdictOf } from "./donnees.js";
import { rowSentence, shortName } from "./portefeuille.js";

const dot = (s) => `<span class="pi-mk pi-mk-${s}" aria-hidden="true"></span>`;
const short = (c) => esc(String(c ?? "").slice(0, 7));

/** The words of a list of steps: « l'étape 3, Plancher et l'étape 5, Gouverner ». */
export function stepsSaid(ids) {
  const T = piste().told, all = ["frame", "architect", "floor", "iterate", "govern", "handover"];
  const said = [...new Set(ids.filter(Boolean))].sort((a, b) => all.indexOf(a) - all.indexOf(b)).map((id) => T.step(all.indexOf(id) + 1, stepName(id)));
  return said.length > 1 ? `${said.slice(0, -1).join(", ")}${T.and}${said.at(-1)}` : said[0] ?? "";
}

/** One card of what blocks: a kind and the check's text, at one step, with every place it stands for. */
function card(g) {
  const B = piste().blocks;
  const head = g.step ? `${["frame", "architect", "floor", "iterate", "govern", "handover"].indexOf(g.step) + 1}. ${esc(stepName(g.step))}` : esc(B.unplaced);
  const kind = flx().kind?.[g.kind] ?? g.kind ?? "";
  const place = (p) => `<li><code translate="no">${esc(p.file ? (p.line ? B.line(p.file, p.line) : B.fileOnly(p.file)) : "")}</code>${p.rule ? ` <span class="soft">· ${esc(B.rule)} <code translate="no">${esc(p.rule)}</code></span>` : ""}</li>`;
  const places = g.places.length > 3
    ? `<details class="pi-lieux-d"><summary>${esc(B.places(g.places.length))}</summary><ul class="pi-lieux">${g.places.map(place).join("")}</ul></details>`
    : `<ul class="pi-lieux">${g.places.map(place).join("")}</ul>`;
  const r = renamed(g.problem);
  const cite = r ? `<div class="pi-diff"><p><span class="d-k">${esc(B.cites)}</span><code translate="no">${esc(r.pointer.slice(0, r.pointer.length - r.symbol.length))}<del>${esc(r.symbol)}</del></code></p><p class="d-s">${esc(B.notFound)}</p></div>` : "";
  const text = g.problem ? `<details class="pi-tel"><summary>${esc(B.asWritten)}</summary><p class="pi-verb" lang="en" translate="no">${esc(g.problem)}</p></details>` : "";
  return `<article class="pi-ref"><p class="pi-ref-e">${dot("refus")}<span>${head} · ${esc(kind)}</span></p>${places}${cite}${text}</article>`;
}
/** A required document missing at a step: its name and its state, as runward-fleet's reading says them. */
function missingCard(x, d) {
  const B = piste().blocks;
  return `<article class="pi-ref"><p class="pi-ref-e">${dot("refus")}<span>${x.n}. ${esc(stepName(x.id))} · ${B.piece(pieceName(d), esc(flx().pieces.state?.[d.state] ?? d.state))}</span></p><ul class="pi-lieux"><li><code translate="no">${esc(d.relPath ?? "")}</code></li></ul></article>`;
}

/** « Ce qui bloque », for the whole application (no station chosen). */
function blocks(m) {
  const B = piste().blocks, st = stations(m), v = st.verdict;
  if (v === "clean") return `<p class="pi-pan-t">${dot("ok")}<span>${esc(B.none)}</span></p>`;
  if (v === "level-not-met") return `<p class="pi-pan-t">${dot("ok")}<span>${esc(B.level)}</span></p>`;
  if (v !== "gaps") return `<p class="pi-pan-t">${dot("attente")}<span>${esc(B.silent)}</span></p>`;
  const groups = blockGroups(st);
  const missing = st.stations.flatMap((x) => x.missing.map((d) => missingCard(x, d)));
  const n = groups.reduce((a, g) => a + g.places.length, 0) + missing.length;
  const gate = st.gateOnly.length ? `<p>${esc(B.gateOnly(stepsSaid(st.gateOnly)))}</p>` : "";
  return `<h3 class="pi-pan-t">${dot("refus")}<span>${esc(n ? B.lead(n) : B.title)}</span></h3>${gate}<div class="pi-cartes">${[...groups.map(card), ...missing].join("")}</div>`;
}
/** A station's panel: its documents, its requirements when known, what blocks there. */
function stationPanel(m, x) {
  const A = piste().app, P = piste();
  const word = P.states[x.state] ?? "";
  const pins = x.pieces.length ? `<ul class="pi-pins">${x.pieces.map((d) => `<li class="${d.state === "filled" ? "" : "pin-r"}">${dot(d.state === "filled" ? "ok" : "refus")}<span>${pieceName(d)}</span></li>`).join("")}</ul>` : `<p class="soft">${esc(A.noPiece)}</p>`;
  const st = stations(m);
  const mine = blockGroups({ ...st, stations: [x], unplaced: [] });
  const here = mine.length || x.missing.length ? `<div class="pi-cartes">${[...mine.map(card), ...x.missing.map((d) => missingCard(x, d))].join("")}</div>` : `<p class="soft">${esc(A.stepNothing)}</p>`;
  return `<h3 class="pi-pan-t">${dot(x.state)}<span>${esc(A.station(x.n, stepName(x.id), word))}</span></h3>
    <div class="pi-pan-g"><div><h4 class="h2">${esc(A.stepPieces)}</h4>${pins}${x.rows ? `<p class="soft small">${esc(A.stepRows(x.rows))}</p>` : ""}</div>
    <div><h4 class="h2">${esc(A.stepBlocks)}</h4>${here}</div></div>`;
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
  return `<section class="scr verre pi-fen pi-recit-f" aria-label="${esc(T.title)}"><h2 class="scr-bar">${esc(T.title)}</h2><div class="scr-body"><p class="note">${esc(T.lead)}</p><ol class="pi-recit">${items.map(([d, t]) => `<li>${d}<p>${t}</p></li>`).join("")}</ol></div></section>`;
}

/** The checked deliveries, most recent first: the status's acts of this application. `reasonOf` says a refusal's code. */
function timeline(m, line, { reasonOf, received, fresh }) {
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
  return `<section class="scr verre pi-fen pi-hist-f" aria-label="${esc(H.title)}"><h2 class="scr-bar">${esc(H.title)}</h2><div class="scr-body">${items ? `<ol class="pi-hist">${items}</ol>` : `<p class="note">${esc(H.none)}</p>`}${since}
    ${earlier ? `<p class="note">${esc(H.verdictKept)}</p>` : ""}<p class="note"><a href="#/envois">${esc(H.journal)}</a></p></div></section>`;
}

/** What moved, when a live read brought a new check of this application (vif.js). HTML-safe. */
export function movedSection(d) {
  if (!d) return "";
  const V = piste().vif;
  const lines = [];
  if (d.verdict) lines.push(esc(V.verdict(stateWord(d.verdict[0]), stateWord(d.verdict[1]))));
  for (const [k, f] of [["lifted", V.lifted], ["raised", V.raised], ["filled", V.filled], ["emptied", V.emptied], ["decided", V.decided]]) if (d[k].length) lines.push(esc(f(d[k].length, stepsSaid(d[k]))));
  if (!lines.length) lines.push(esc(V.same));
  return `<section class="scr verre pi-fen pi-bouge-f neuf" aria-label="${esc(V.moved)}"><h2 class="scr-bar">${esc(V.moved)}</h2><div class="scr-body"><ul class="pi-recit">${lines.map((t) => `<li>${dot("ok")}<p>${t}</p></li>`).join("")}</ul><p class="note">${esc(V.movedLead)}</p></div></section>`;
}

/**
 * The reading of one application. `m` the index's mission, `line` its status line, `sel` the open station (or null),
 * `extra` the decision reading's own panels (verify, level), `detail` runward-fleet's reading, `ctx` what the timeline
 * needs, `bouge` what a live read moved, `premier` true right after the first check was confirmed.
 */
export function reading(m, line, { sel = null, verify, level, detail, ctx, bouge = null, premier = false }) {
  const P = piste(), A = P.app, st = stations(m), v = st.verdict;
  const name = shortName(m);
  const a = line?.accepted;
  const meta = a ? A.meta(when(a.receivedAt, { sec: false }), a.runNumber ? esc(a.runNumber) : "", a.commit ? `<code translate="no">${short(a.commit)}</code>` : "") : "";
  const title = v === "gaps" ? A.refused : v === "clean" ? A.clean : v === "level-not-met" ? A.level : A.silent;
  const first = premier ? `<p class="pi-premier" role="status">${dot("ok")}<span>${esc(P.first.verdict(name))}</span></p>` : "";
  const panels = [`<div class="pi-pan" id="pi-pan-0"${sel ? " hidden" : ""}>${blocks(m)}${st.verdict !== "not-observed" ? `<p class="soft small pi-choisir">${esc(A.choose)}</p>` : ""}</div>`,
    ...st.stations.map((x) => `<div class="pi-pan" id="pi-pan-${x.n}"${sel === x.n ? "" : " hidden"}>${stationPanel(m, x)}</div>`)].join("");
  return `${first}<div class="tete pi-tete pi-app"><p class="pi-meta">${chip(v)}${meta ? `<span class="soft">${meta}</span>` : ""}</p>
      <h1 class="t1"><span translate="no">${esc(name)}</span> · ${esc(title)}</h1><p class="sous">${rowSentence(m, line, ctx.reasonText)}${v === "gaps" || v === "clean" ? ` ${esc(A.decision)}` : ""}</p></div>
    <section class="scr verre pi-fen pi-lect" aria-label="${esc(A.rail)}"><h2 class="scr-bar">${esc(A.rail)}</h2><div class="scr-body">${rail(m, name, { grand: true, sel, bouge: bouge?.steps ?? [], id: "pi-grand" })}<div id="pi-pan" class="pi-pans">${panels}</div></div></section>
    ${movedSection(bouge)}
    <div class="pi-duo">${told(m, line)}${verify}</div>
    ${timeline(m, line, { ...ctx, fresh: Boolean(bouge) })}${level}
    <details class="pi-pli" data-pli="detail-app"><summary>${esc(P.detail.app)}</summary><div class="pi-pli-b">${detail}</div></details>`;
}
