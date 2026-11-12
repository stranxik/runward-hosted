// The lines the dashboard, a mission, the uploads and the sidebar say with the words of the lexicon
// (web/views/lexique.js): a verdict's mark and word, the missions in order, a mission's cause, its source and its next
// gesture, a line of the journal, the provenance of the index. Everything is read from the index served and from
// GET /api/v0/fleet/status, already loaded for the screen: opening a mission costs 0 more read (architecture §6).
// No example data: what is shown is the tenant's, and every value from them is escaped here.
import { S, esc } from "./base.js";
import { hm } from "./time.js";
import { mk, etq, go } from "./marks.js";
import { mots } from "./lexique.js";
import { versAccord } from "./liens.js";

const SHAPE = { gaps: "inv", "level-not-met": "inv", "not-observed": "void", clean: "full" };
const ORDER = { gaps: 0, "level-not-met": 1, "not-observed": 2, clean: 3 };
const GATE_KEY = { frame: "frame", architect: "architect", floor: "floor", iterate: "iterate", govern: "govern", hand: "handover" };
/** A verdict's shape and word, in the reader's language; an unknown verdict reads as not observed. */
export const etatOf = (v) => { const k = Object.hasOwn(SHAPE, v) ? v : "not-observed"; return [SHAPE[k], mots().verdict[k]]; };
export const chipOf = (v) => { const [sh, w] = etatOf(v); return sh === "inv" ? mk("inv", w) : etq(sh, w); };
export const verdictOf = (m) => (m && typeof m.latest === "object" && m.latest ? m.latest.verdict : "not-observed");
export const nomLong = (m) => m.name;
export const nomCourt = (m) => (m.path && m.path !== "." ? m.path.split("/").pop() : m.name.split("/").pop());
export const triees = () => (S.index ? [...S.index.missions].sort((a, b) => (ORDER[verdictOf(a)] ?? 9) - (ORDER[verdictOf(b)] ?? 9)) : []);
export const ligne = (id) => S.status?.lines.find((l) => l.mission === id) ?? null;
/** A gate as runward writes it (« 3 · Floor »), said with its phase's name; text, escaped by its caller. */
export function porte(gate) {
  const W = mots();
  if (!gate || gate === "all gates passed") return W.lines.allGates;
  const g = /^(\d+)\s*·\s*([A-Za-z]+)/.exec(gate);
  return g ? W.lines.gate(g[1], W.phase[GATE_KEY[g[2].toLowerCase()]] ?? g[2]) : gate;
}
const manquants = (m) => (typeof m.latest === "object" ? (m.latest.deliverables?.list ?? []).filter((d) => d.state !== "filled") : []);
export const sourceDe = (m) => (typeof m.latest === "object" ? S.index.sources.find((s) => s.id === m.latest.src)?.path : null);
/** A refusal's line, in the reader's language; a code the lexicon does not know, as written. Text. */
const motif = (code) => (Object.hasOwn(mots().refusal, code) ? mots().refusal[code] : code);
export function cause(m) {
  const L = mots().lines, v = verdictOf(m), st = ligne(m.id);
  if (v === "gaps") {
    const mq = manquants(m);
    return mq.length ? L.blocked(esc(porte(m.latest.currentGate)), mq.length, mq.slice(0, 2).map((d) => `<code>${esc(d.relPath)}</code>`).join(L.and)) : L.refusedAt(esc(porte(m.latest.currentGate)));
  }
  if (v === "level-not-met") return L.levelNotMet;
  if (v === "not-observed") {
    if (st?.lastRefusal) return L.lastRefused(hm(st.lastRefusalAt), esc(st.lastRefusalSeq), esc(motif(st.lastRefusal)));
    return L.noUpload;
  }
  return L.clean;
}
export function sourceLigne(m) {
  const L = mots().lines, st = ligne(m.id);
  if (!st || !st.accepted) return L.sourceJournal(st?.lastRefusalSeq ? esc(st.lastRefusalSeq) : "");
  return L.source(`<code>${esc(sourceDe(m) ?? "")}</code>`, esc(String(st.accepted.commit ?? "").slice(0, 12)), esc(st.accepted.seq), hm(st.accepted.receivedAt));
}
export function geste(m) {
  const W = mots(), v = verdictOf(m), st = ligne(m.id);
  if (v === "gaps" && m.latest.next?.command) return `<span class="k">${W.lines.next}</span><code class="cmd" translate="no">${esc(m.latest.next.command)}</code>`;
  if (v === "level-not-met") return go(`#/mission/${m.id}`, W.lines.seeDeclared, { q: true });
  if (v === "not-observed") return st?.consent ? `<span class="small">${etq("full", W.common.consented)} ${W.lines.nextRead}</span>` : go(versAccord(st), W.lines.consentInAccess, { q: true });
  return "";
}
export function comptes() {
  const by = Object.fromEntries((S.index?.fleet.byVerdict ?? []).map((g) => [g.state, g.n]));
  return { N: S.index?.fleet.declared ?? 0, gaps: by.gaps ?? 0, lnm: by["level-not-met"] ?? 0, silent: by["not-observed"] ?? 0, clean: by.clean ?? 0 };
}
/** A line of the journal: an upload (the workload's acts) or another act; the whole text escaped. */
export function jLigne(e) {
  const W = mots(), L = W.lines;
  if (e.who === "workload") {
    const shape = e.what === "send-accepted" ? "full" : e.what === "send-not-accepted" || e.what === "send-quarantined" ? "inv" : "void";
    const quoi = Object.hasOwn(L.quoi, e.what) ? L.quoi[e.what](e.seq, motif(e.refusal)) : L.act(W.acts[e.what] ?? e.what, e.seq);
    return `<li><span class="h">${hm(e.at)}</span><span class="m"><span class="mk mk-${shape}" aria-hidden="true"></span></span><span><span translate="no">${esc(e.repository ?? "")}</span>${e.runNumber ? `, ${e.forge === "gitlab" ? "pipeline" : "run"} ${esc(e.runNumber)}` : ""}<span class="sub">${esc(quoi)}</span></span></li>`;
  }
  return `<li><span class="h">${hm(e.at)}</span><span class="m"><span class="mk mk-void" aria-hidden="true"></span></span><span>${esc(W.acts[e.what] ?? e.what)}${e.repository ? ` · <span translate="no">${esc(e.repository)}</span>` : ""}<span class="sub">${esc(L.act(W.who[e.who] ?? e.who, e.seq))}</span></span></li>`;
}
export const provLigne = () => {
  const W = mots(), i = S.status?.index;
  return i ? W.lines.prov(esc(S.index?.asOf?.label ?? ""), esc(String(i.sha256).slice(0, 12)), esc(i.fleetVersion), hm(i.publishedAt), esc(i.seq)) : W.common.noIndex;
};
