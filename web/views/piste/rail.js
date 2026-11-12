// « La piste » (ADR-0035): the rail of an application, six stations from Cadrer to Transmettre. The line is solid as far
// as the check lets the version go, then dotted; the station where it refuses carries the refused mark (the vermilion
// diamond of the app's layer, `--refus`, the reading's own); a station where nothing is required is a small hollow
// ring; an application with no check received is dotted from end to end. The same rail in small (a row of the
// portfolio, the names of the steps in one shared header) and in large (an application's reading, each station a
// button that opens its documents). Every value is escaped here; the words are the app's (lexique.js, mots.js) and
// runward-fleet's (its LEXICON, for the documents and the kinds of refusal).
import { esc } from "../base.js";
import { mots, lang } from "../lexique.js";
import { LEXICON } from "../fleet-views.js";
import { piste } from "./mots.js";
import { ETAPES, stations, kindsOf } from "./donnees.js";

/** runward-fleet's words in the reader's language. */
export const flx = () => LEXICON[lang() === "fr" ? "fr" : "en"];
/** A step's name, in the reader's language. */
export const stepName = (id) => mots().phase[id] ?? id;
/** A required document's name as runward-fleet's reading names it, else as the check writes it (marked as data). */
export function pieceName(d) {
  const known = flx().pieces.piece?.[d?.relPath];
  return known ? esc(known) : `<span translate="no" lang="en">${esc(d?.artifact ?? d?.relPath ?? "")}</span>`;
}
/** A state's word, as runward-fleet's reading says it. */
export const stateWord = (v) => flx().state?.[v] ?? flx().state["not-observed"];
/** The state of an application, said by the reading's own mark (shape, then hue: web/app.css) and its word. */
export const chip = (v) => `<span class="etq pi-etat" data-state="${esc(v)}"><span data-role="mark" aria-hidden="true"></span>${esc(stateWord(v))}</span>`;

/** The line under the stations: dotted, and solid as far as `reach` (0 to 1), across (or standing, on a phone). */
const ligne = (reach) => { const pct = Math.round(Math.max(0, Math.min(1, reach)) * 1000) / 10; return `<li class="pi-ligne" aria-hidden="true"><span class="pi-rempli" style="width:${pct}%"></span><span class="pi-rempli-v" style="height:${pct}%"></span></li>`; };

const MARK = { ok: "ok", refus: "refus", vide: "vide", attente: "attente", ici: "ici" };
const dot = (state) => `<span class="pi-mk pi-mk-${MARK[state] ?? "attente"}" aria-hidden="true"></span>`;

/** The sub-line of a station on the large rail: its refusals, its documents, its requirements when known. */
function sub(x) {
  const A = piste().app.sub;
  if (x.state === "attente") return "";
  if (x.state === "refus") {
    const parts = [x.refusals.length ? A.refus(x.refusals.length) : "", x.missing.length ? A.missing(x.missing.length) : ""].filter(Boolean);
    return parts.length ? parts.join(", ") : A.refus(0);
  }
  if (x.state === "vide") return A.vide;
  return [A.pieces(x.pieces.length), x.rows ? A.rows(x.rows) : ""].filter(Boolean).join(", ");
}

/**
 * The rail of an application. `grand`: the large one, its stations buttons that open their panel (`sel`, the open
 * one); `bouge`: the steps a live check changed (a quiet badge); `id`: the element's id.
 */
export function rail(m, name, { grand = false, sel = null, bouge = [], id = "" } = {}) {
  const P = piste(), st = stations(m);
  const label = P.stepsOf(name);
  const items = st.stations.map((x) => {
    const word = x.state === "ok" && st.verdict === "level-not-met" ? P.states.niveau : P.states[x.state];
    const after = st.stop && x.n > st.stop;
    const cls = `pi-st s-${x.state}${after ? " apres" : ""}${bouge.includes(x.id) ? " bouge" : ""}${sel === x.n ? " sel" : ""}`;
    const said = P.app.station(x.n, stepName(x.id), word);
    const badge = bouge.includes(x.id) ? `<span class="pi-bouge">${esc(P.vif.badge)}</span>` : "";
    if (!grand) return `<li class="${cls}"><span class="pi-pt">${dot(x.state)}</span><span class="pi-nom" aria-hidden="true"><span class="num">${x.n}</span></span><span class="vh">${esc(said)}</span>${badge}</li>`;
    // the button's name is its visible text (the step, its sub-line), with its number and its state said around it
    const inner = `<span class="pi-pt">${dot(x.state)}</span><span class="pi-nom"><span class="vh">${x.n}. </span>${esc(stepName(x.id))}<span class="vh">, ${esc(word)}.</span></span><span class="pi-sub">${esc(sub(x))}</span>${badge}`;
    return `<li class="${cls}"><button type="button" data-pi-station="${x.n}" aria-pressed="${sel === x.n}" aria-controls="pi-pan-${x.n}">${inner}</button></li>`;
  }).join("");
  return `<ol class="pi-piste${grand ? " grand" : ""}${st.verdict === "not-observed" || st.verdict === "not-available" ? " vide" : ""}"${id ? ` id="${esc(id)}"` : ""} data-portee="${Math.round(st.reach * 100)}" aria-label="${esc(label)}">${ligne(st.reach)}${items}</ol>`;
}

/** The names of the six steps, once, above the rows of the portfolio (hidden from assistive technologies: each station says its own). */
export const heads = () => `<div class="pi-tetes" aria-hidden="true"><span></span><ol>${ETAPES.map((id, i) => `<li><span class="num">${i + 1}</span> ${esc(stepName(id))}</li>`).join("")}</ol><span></span></div>`;

/** The rail of the first run: five gestures, the current one marked. */
export function firstRail(cur) {
  const F = piste().first;
  const n = F.steps.length;
  const reach = Math.max(0, Math.min(1, cur / (n - 1)));
  return `<ol class="pi-piste grand mer" data-portee="${Math.round(reach * 100)}" aria-label="${esc(F.rail)}">${ligne(reach)}${F.steps.map((p, i) => {
    const s = i < cur ? "ok" : i === cur ? "ici" : "attente";
    return `<li class="pi-st s-${s}"${i === cur ? ' aria-current="step"' : ""}><span class="pi-pt">${dot(s)}</span><span class="pi-nom">${esc(p)}</span><span class="pi-sub">${esc(i < cur ? F.done : i === cur ? F.now : "")}</span></li>`;
  }).join("")}</ol>`;
}

/** The first-run window (ADR-0035): the five gestures as a rail, where the member stands, then what to do (HTML). */
export function firstRun(cur, body = "") {
  const F = piste().first;
  return `<section class="scr verre pi-fen pi-mer" aria-label="${esc(F.rail)}"><h2 class="scr-bar">${esc(F.rail)}</h2><div class="scr-body">${firstRail(cur)}${body ? `<div class="pi-mer-b">${body}</div>` : ""}</div></section>`;
}

/**
 * What an application's refusals say, in one or two sentences of the decision maker: the most frequent kind for its
 * count (a cited name no longer found when every refusal of that kind says so), then how many others. HTML-safe.
 */
export function kindsSentence(m) {
  const P = piste(), K = kindsOf(m);
  if (!K.length) return "";
  const [top, ...rest] = K;
  const words = P.kinds;
  const said = top.kind === "evidence-refused" && top.renamed === top.n ? words.renamed(top.n)
    : Object.hasOwn(words, top.kind) && top.kind !== "other" && top.kind !== "renamed" ? words[top.kind](top.n)
    : words.other(top.n, flx().kind?.[top.kind] ?? top.kind);
  const others = rest.reduce((a, k) => a + k.n, 0);
  return esc(`${said}${others ? ` ${P.row.others(others)}` : ""}`);
}
