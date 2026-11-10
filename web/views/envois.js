// Uploads: the journal.
import { esc, short, S } from "./base.js";
import { when } from "./time.js";
import { mk, head, reqNote, act, loadingView, go } from "./marks.js";
import { WHO, WHAT } from "./lexique.js";
import { claimsTable } from "./claims.js";

function jrow(e) {
  const b = e.body, d = b.detail ?? {};
  const state = { "send-accepted": mk("full", "accepté, courant"), "send-historical": mk("half", "accepté, historique"), "send-pending": mk("half", "gardé, à confirmer"), "send-not-accepted": mk("inv", "non accepté"), "send-quarantined": mk("inv", "non publié") }[b.what] ?? mk("void", b.who.type === "operator" ? "geste d'opérateur" : "acte");
  const who = b.who.type === "workload" && d.claims ? `<span class="k">${WHO.workload}</span><span data-verbatim translate="no">${esc(d.claims.repository)}</span>${d.mission ? `<span class="k">mission</span><code>${esc(d.mission)}</code>` : ""}` : `<span class="k">${esc(WHO[b.who.type] ?? b.who.type)}</span>`;
  const what = `<span class="k">quoi</span>${esc(WHAT[b.what] ?? b.what)}${d.kind ? ` · ${esc(d.kind)}` : ""}${d.sha256 ? `<div><code>sha256 ${esc(short(d.sha256))}</code></div>` : ""}${d.indexSha256 ? `<div class="small soft">index <code>${esc(short(d.indexSha256))}</code></div>` : ""}`;
  const dates = `<span class="k">reçu, heure du service (déclarée)</span>${when(b.dates?.received?.at)}${b.dates?.issued ? `<span class="k">émis, jeton OIDC</span>${when(b.dates.issued.at)}` : ""}${b.who.type === "workload" ? `<span class="k">commit</span>${d.commit ? `<code>${esc(String(d.commit).slice(0, 12))}</code>` : `<span class="soft">à dater</span>`}` : ""}${b.requestId ? `<span class="k">requête</span><code>${esc(b.requestId)}</code>` : ""}`;
  const refusal = d.refusal ? `<div class="jref small"><code>${esc(d.refusal)}</code> ${esc(e.text?.message ?? "")} <span class="soft">${esc(e.text?.action ?? "")}</span></div>` : "";
  const note = b.what === "send-historical" ? `<div class="jref small">Relance d'un run plus ancien que l'envoi courant (run n° ${esc(d.currentRunNumber)}) : gardé comme historique, jamais comme courant.</div>` : "";
  const prov = d.claims ? `<details class="prov"><summary>Provenance, claim par claim</summary>${claimsTable(d.claims)}</details>` : "";
  return `<li class="jrow"><div class="rv">n° <b>${e.seq}</b></div><div><span class="k">état</span>${state}</div><div>${who}</div><div>${what}</div><div class="small">${dates}</div>${refusal}${note}${prov}</li>`;
}
export function viewEnvois() {
  const j = S.journal;
  if (S.journalError) return { title: "Envois", key: "envois", signed: "in", html: `${head("journal du locataire", "")}<h1 class="v">${mk("inv", "non affiché")} Le journal ne s'affiche pas.</h1><p class="face">Le service n'a pas répondu. Vos envois ne sont pas perdus : ils sont écrits avant toute réponse.${reqNote(S.journalError)}</p><div class="actions">${act("reload-screen", "Réessayer")}</div>` };
  if (!j) return loadingView("Envois");
  const n = j.head?.seq ?? 0;
  const list = j.entries.length ? `<ol class="journal" aria-label="Entrées du journal, de la plus récente à la plus ancienne">${j.entries.map(jrow).join("")}</ol>`
    : `<h2>Aucun envoi reçu pour l'instant.</h2><p>Le premier arrive après la fin du job de CI qui suit votre fusion sur <code>main</code>, si le workflow d'envoi est appelé.</p>`;
  return { title: "Envois", key: "envois", signed: "in", html: `${head(`journal du locataire · ${n} entrée${n > 1 ? "s" : ""} · tête <b>${esc(short(j.head?.hash))}</b>`, "chaîné par empreinte · tête recopiée dans chaque résumé de job")}
    <h1 class="v">Ce que vos CI ont envoyé.</h1>${list}
    <div class="actions">${j.end ? `<p class="small soft fin" role="note">Début du journal : entrée n° 1.</p>` : go(`#/envois/${j.next}`, "Entrées plus anciennes", { q: true })}</div>
    <p class="note">${esc(j.note)} Comparer la tête servie à la dernière tête d'un résumé de job montre une troncature. Les résumés des dépôts publics laissent voir le rythme des envois de vos dépôts privés ; c'est accepté tant que cette flotte n'a que vos dépôts.</p>` };
}
