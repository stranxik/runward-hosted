// The journal (ADR-0037 point 2): every entry, newest first, as a list and the detail of the one shown, in the panes of
// the fixed shell (web/views/volets.js). Its filters (an application, a kind of entry, a period) are the service's
// (GET /api/v0/journal?mission=&kind=&days=), written in the address so that a link keeps them
// (web/views/journal-filtres.js): #/envois[/<cursor>]?app=&quoi=&periode=&entree=. Its states: loading, error, a
// journal with nothing yet, filters that keep nothing, an entry shown that the page does not hold.
import { esc, short, S } from "./base.js";
import { when, hm, day } from "./time.js";
import { mk, reqNote, act } from "./marks.js";
import { lang, mots } from "./lexique.js";
import { claimsTable } from "./claims.js";
import { fenetre, barre, rangee, liste, tete, entete, corps, feuille, pli, etat, squelette, VOLET_FOCUS } from "./volets.js";
import { lireFiltres, versJournal, filtre, QUOI, PERIODES } from "./journal-filtres.js";

/** An entry's state: its mark and its word (the journal's own, else an act, else an operator's gesture). */
function etatEntree(b) {
  const J = mots().envois;
  if (Object.hasOwn(J.state, b.what)) return mk(b.what === "send-accepted" ? "full" : b.what === "send-not-accepted" || b.what === "send-quarantined" ? "inv" : "half", J.state[b.what]);
  return mk("void", b.who?.type === "operator" ? J.operatorGesture : J.act);
}
/** The repository an entry is about: a workload's claims, else the repository a gesture was made on (the status lines). */
function depotDeLEntree(b) {
  const d = b.detail ?? {};
  if (d.claims?.repository) return { name: d.claims.repository, mission: d.mission || null };
  const line = (S.status?.lines ?? []).find((l) => l.repositoryRef && l.repositoryRef === b.object);
  if (line) return { name: line.repository, mission: line.mission };
  return d.name ? { name: d.name, mission: Array.isArray(d.missions) ? d.missions[0] ?? null : null } : null;
}
const quoi = (b) => { const W = mots(); return Object.hasOwn(W.acts, b.what) ? W.acts[b.what] : b.what; };
const qui = (b) => { const W = mots(), P = W.parcours.journal; return b.who?.type === "human" ? P.human : Object.hasOwn(W.who, b.who?.type) ? W.who[b.who.type] : String(b.who?.type ?? ""); };

/** The filters, as three choices of the window's bar; each choice writes the address (web/views/events.js). */
function filtres(f) {
  const P = mots().parcours.journal;
  const apps = [...new Set([...(S.status?.lines ?? []).map((l) => l.mission), ...(f.app ? [f.app] : [])])].sort();
  const sel = (name, label, first, options, value) => `<label class="jf"><span class="vh">${esc(label)}</span><select name="${name}" data-focus-key="jf:${name}" aria-label="${esc(label)}">
      <option value="">${esc(first)}</option>${options.map(([v, t]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
  return `<form class="filtres" id="journal-filtres" role="search" aria-label="${esc(P.filters)}">
    ${sel("app", P.app, `${P.app} · ${P.all}`, apps.map((m) => [m, m]), f.app)}
    ${sel("quoi", P.kind, `${P.kind} · ${P.allKinds}`, Object.keys(QUOI).map((k) => [k, P.kinds[k]]), f.quoi)}
    ${sel("periode", P.period, `${P.period} · ${P.always}`, Object.keys(PERIODES).map((k) => [k, P.periods[k]]), f.periode)}
    ${filtre(f) ? `<a class="btn btn-q jf-x" href="${esc(versJournal({ entree: f.entree }))}" data-focus-key="jf:x">${esc(P.clear)}</a>` : ""}
    <noscript><button class="btn" type="submit">${esc(P.apply)}</button></noscript></form>`;
}

/** One row of the list: its number, its mark, what happened, when, and who or where. */
function ligneEntree(e, f, cursor, choisie) {
  const b = e.body, r = depotDeLEntree(b);
  const where = r ? `<span translate="no">${esc(r.mission ?? r.name)}</span>` : esc(qui(b));
  return rangee({
    href: versJournal({ ...f, entree: e.seq }, cursor), cle: `j:${e.seq}`, courant: f.entree === e.seq, choisie, cls: "jrow",
    html: `<span class="no">${esc(mots().envois.no)} ${e.seq}</span><span class="jm">${etatEntree(b)}</span><span class="q">${esc(quoi(b))}</span><span class="t">${hm(b.dates?.received?.at)}</span><span class="w">${where}</span>`,
  });
}

/** The detail of one entry: every field the journal keeps, the refusal in the reader's words, the provenance folded. */
function detailEntree(e, f) {
  const W = mots(), J = W.envois, P = W.parcours.journal, F = P.fields;
  const b = e.body, d = b.detail ?? {}, r = depotDeLEntree(b);
  const rows = [[F.state, etatEntree(b)], [F.who, `${esc(qui(b))}${b.who?.type === "workload" && r ? ` · <span translate="no">${esc(r.name)}</span>` : ""}`]];
  if (r?.mission || d.mission) rows.push([F.mission, `<code>${esc(r?.mission ?? d.mission)}</code>`]);
  else if (r) rows.push([W.declarer.repo, `<span translate="no">${esc(r.name)}</span>`]);
  rows.push([F.what, `${esc(quoi(b))}${d.kind ? ` · ${esc(d.kind)}` : ""}`]);
  if (d.sha256) rows.push([F.sha, `<code>${esc(d.sha256)}</code>`]);
  if (d.indexSha256) rows.push([F.index, `<code>${esc(d.indexSha256)}</code>`]);
  if (d.runNumber) rows.push([F.run, `${esc(J.no)} ${esc(d.runNumber)}${d.runAttempt ? ` · ${esc(d.runAttempt)}` : ""}`]);
  if (b.who?.type === "workload") rows.push([F.commit, d.commit ? `<code>${esc(String(d.commit).slice(0, 12))}</code>` : when(null)]);
  rows.push([F.received, when(b.dates?.received?.at)]);
  if (b.dates?.issued) rows.push([F.issued, when(b.dates.issued.at)]);
  if (b.requestId) rows.push([F.request, `<code>${esc(b.requestId)}</code>`]);
  rows.push([F.hash, `<code>${esc(short(e.hash))}</code>`]);
  if (e.prev) rows.push([F.prev, `<code>${esc(short(e.prev))}</code>`]);
  const refusal = d.refusal ? `<p class="erreur"><code>${esc(d.refusal)}</code> ${esc(e.text?.message ?? (Object.hasOwn(W.refusal, d.refusal) ? W.refusal[d.refusal] : ""))} <span class="soft">${esc(e.text?.action ?? "")}</span></p>` : "";
  const note = b.what === "send-historical" ? `<p class="fx-n">${String(b.who.id).startsWith("gitlab:") ? J.historicalPipeline(esc(d.currentRunNumber)) : J.historical(esc(d.currentRunNumber))}</p>` : "";
  const prov = d.claims ? pli({ cle: "prov", titre: J.provenance, corps: claimsTable(d.claims) }) : "";
  const mission = r?.mission ?? d.mission ?? null;
  const app = mission && (S.index?.missions ?? []).some((m) => m.id === mission) ? `<p><a class="lien" href="#/decision/${esc(encodeURIComponent(mission))}">${esc(P.openApp)}</a></p>` : "";
  return `${entete({ meta: `<span class="soft">${esc(W.frame.journal)}</span>`, titre: `${esc(P.entry(e.seq))} · ${esc(quoi(b))}`, phrase: `${r ? `<span translate="no">${esc(r.name)}</span>, ` : ""}${when(b.dates?.received?.at, { sec: false })}` })}
    ${corps(`${feuille({ corps: `<div class="sh-b"><dl class="champs">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>${refusal}${note}</div>` })}${prov}${app}`)}`;
}

export function viewEnvois(sub = "", query = "") {
  const W = mots(), J = W.envois, P = W.parcours.journal, C = W.common;
  if (sub && !/^[0-9]{1,15}$/.test(sub)) return null;
  const f = lireFiltres(query);
  const base = { title: J.title, key: "envois", signed: "in", main: "volets", cle: "envois", sel: f.entree, focus: VOLET_FOCUS };
  if (S.journalError) return { ...base, ecran: "detail", html: fenetre({ bar: barre({ titre: esc(J.title) }), seul: etat({ h1: true, marque: mk("inv", C.notShown), titre: J.h1Error, texte: `${J.faceError}${reqNote(S.journalError)}`, actions: `${act("reload-screen", C.retry)}${filtre(f) ? `<a class="btn btn-q" href="${esc(versJournal({}))}">${esc(P.clear)}</a>` : ""}` }) }) };
  const j0 = S.journal;
  if (!j0) return { ...base, ecran: "liste", html: squelette(8, W.marks.loading) };
  const j = { ...j0, entries: Array.isArray(j0.entries) ? j0.entries : [] };
  const n = j.head?.seq ?? 0;
  // nothing yet, and no filter: the journal is empty, said once
  if (!j.entries.length && !filtre(f) && !sub) return { ...base, ecran: "detail", html: fenetre({ bar: barre({ titre: esc(J.title) }), seul: etat({ h1: true, titre: J.none, texte: J.noneText }) }) };
  const counted = filtre(f) ? P.filtered(j.total ?? j.entries.length) : P.count(n);
  const bar = barre({ titre: `${esc(J.title)} <span class="mono">· ${esc(P.count(n))} · ${esc(short(j.head?.hash))}</span>`, filtres: filtres(f), direct: `<p class="direct perime">${J.headR}</p>` });
  // the rows, one day at a time; on a desk the newest is shown beside them when no address names one
  const shown = f.entree !== null ? j.entries.find((e) => e.seq === f.entree) ?? null : null;
  const choisie = f.entree === null && j.entries.length ? j.entries[0].seq : null;
  let jour = "";
  const rows = j.entries.map((e) => {
    const at = e.body.dates?.received?.at, d = at ? day(at) : "";
    const sep = d && d !== jour ? `<p class="sec">${esc(d)}</p>` : "";
    jour = d || jour;
    return `${sep}${ligneEntree(e, f, sub, e.seq === choisie)}`;
  }).join("");
  const plus = j.end ? `<p class="fx-n fin" role="note">${J.start}</p>` : `<a class="btn btn-q" href="${esc(versJournal(f, j.next))}">${esc(J.older)}</a>`;
  const recents = sub ? `<a class="btn btn-q" href="${esc(versJournal(f))}">${esc(C.wholeJournal)}</a>` : "";
  // the service's note on its journal is in French (src/application/reading.js): said in the lexicon's words in English
  const note = lang() === "fr" && j.note ? j.note : J.note;
  const vide = etat({ titre: P.noResult, texte: P.noResultText, actions: `<a class="btn" href="${esc(versJournal({}))}">${esc(P.clear)}</a>` });
  const list = `${tete(esc(J.title), esc(counted))}${j.entries.length ? liste(rows, P.list) : vide}<div class="l-pied"><div class="actions">${recents}${plus}</div><p class="fx-n">${esc(note)} ${J.noteMore}</p></div>`;
  const detail = shown ? detailEntree(shown, f)
    : f.entree !== null ? etat({ titre: P.notHere, texte: P.notHereText, actions: `<a class="btn btn-q" href="${esc(versJournal(f, String(f.entree + 1)))}">${esc(P.openPage)}</a>` })
      : choisie !== null ? detailEntree(j.entries[0], f) : etat({ texte: P.choose });
  const crumb = f.entree !== null ? [[J.title, versJournal({ ...f, entree: null }, sub)], [P.entry(f.entree)]] : null;
  return { ...base, ecran: f.entree !== null ? "detail" : "liste", crumb, title: f.entree !== null ? P.entry(f.entree) : J.title, html: fenetre({ bar, liste: list, detail, label: P.choose }) };
}
