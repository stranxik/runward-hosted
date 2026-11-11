// Uploads: the journal.
import { esc, short, S } from "./base.js";
import { when } from "./time.js";
import { mk, head, reqNote, act, loadingView, go } from "./marks.js";
import { lang, mots } from "./lexique.js";
import { claimsTable } from "./claims.js";

function jrow(e) {
  const W = mots(), J = W.envois;
  const b = e.body, d = b.detail ?? {};
  const state = Object.hasOwn(J.state, b.what) ? mk(b.what === "send-accepted" ? "full" : b.what === "send-not-accepted" || b.what === "send-quarantined" ? "inv" : "half", J.state[b.what]) : mk("void", b.who.type === "operator" ? J.operatorGesture : J.act);
  const who = b.who.type === "workload" && d.claims ? `<span class="k">${esc(W.who.workload)}</span><span data-verbatim translate="no">${esc(d.claims.repository)}</span>${d.mission ? `<span class="k">${J.mission}</span><code>${esc(d.mission)}</code>` : ""}` : `<span class="k">${esc(W.who[b.who.type] ?? b.who.type)}</span>`;
  const what = `<span class="k">${J.what}</span>${esc(W.acts[b.what] ?? b.what)}${d.kind ? ` · ${esc(d.kind)}` : ""}${d.sha256 ? `<div><code>sha256 ${esc(short(d.sha256))}</code></div>` : ""}${d.indexSha256 ? `<div class="small soft">index <code>${esc(short(d.indexSha256))}</code></div>` : ""}`;
  const dates = `<span class="k">${J.received}</span>${when(b.dates?.received?.at)}${b.dates?.issued ? `<span class="k">${J.issued}</span>${when(b.dates.issued.at)}` : ""}${b.who.type === "workload" ? `<span class="k">${J.commit}</span>${d.commit ? `<code>${esc(String(d.commit).slice(0, 12))}</code>` : when(null)}` : ""}${b.requestId ? `<span class="k">${J.request}</span><code>${esc(b.requestId)}</code>` : ""}`;
  const refusal = d.refusal ? `<div class="jref small"><code>${esc(d.refusal)}</code> ${esc(e.text?.message ?? "")} <span class="soft">${esc(e.text?.action ?? "")}</span></div>` : "";
  const note = b.what === "send-historical" ? `<div class="jref small">${J.historical(esc(d.currentRunNumber))}</div>` : "";
  const prov = d.claims ? `<details class="prov"><summary>${J.provenance}</summary>${claimsTable(d.claims)}</details>` : "";
  return `<li class="jrow"><div class="rv">${J.no} <b>${e.seq}</b></div><div><span class="k">${J.state0}</span>${state}</div><div>${who}</div><div>${what}</div><div class="small">${dates}</div>${refusal}${note}${prov}</li>`;
}
export function viewEnvois() {
  const W = mots(), J = W.envois, C = W.common;
  const j = S.journal;
  if (S.journalError) return { title: J.title, key: "envois", signed: "in", html: `${head(J.headError, "")}<h1 class="v">${mk("inv", C.notShown)} ${J.h1Error}</h1><p class="face">${J.faceError}${reqNote(S.journalError)}</p><div class="actions">${act("reload-screen", C.retry)}</div>` };
  if (!j) return loadingView(J.title);
  const n = j.head?.seq ?? 0;
  const list = j.entries.length ? `<ol class="journal" aria-label="${esc(J.entries)}">${j.entries.map(jrow).join("")}</ol>`
    : `<h2>${J.none}</h2><p>${J.noneText}</p>`;
  // the service's note on its journal is in French (src/application/reading.js): said in the lexicon's words in English
  const note = lang() === "fr" && j.note ? j.note : J.note;
  return { title: J.title, key: "envois", signed: "in", html: `${head(J.head(n, esc(short(j.head?.hash))), J.headR)}
    <h1 class="v">${J.h1}</h1>${list}
    <div class="actions">${j.end ? `<p class="small soft fin" role="note">${J.start}</p>` : go(`#/envois/${j.next}`, J.older, { q: true })}</div>
    <p class="note">${esc(note)} ${J.noteMore}</p>` };
}
