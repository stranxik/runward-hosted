// A mission: cause, the next gesture, what is missing gate by gate, where the verdict comes from, its
// activity, then its runward-fleet view (in the reader's language, as the other views of the fleet).
import { S, esc } from "./base.js";
import { when } from "./time.js";
import { mk, etq, go } from "./marks.js";
import { renderView } from "./fleet-views.js";
import { lang, mots } from "./lexique.js";
import { versAccord } from "./liens.js";
import { verdictOf, ligne, sourceDe, jLigne, nomCourt, nomLong, chipOf, cause, sourceLigne } from "./lignes.js";
import { niveauLigne, ordre } from "./claims.js";

export function viewMissionDetail(id) {
  if (!S.index) return null;
  const m = S.index.missions.find((x) => x.id === id);
  if (!m) return null;
  const W = mots(), M = W.mission, C = W.common;
  const v = verdictOf(m), st = ligne(m.id), l = typeof m.latest === "object" ? m.latest : null;
  let portes = "";
  if (l) {
    const groupes = [];
    (l.deliverables?.list ?? []).forEach((d) => { let g = groupes.find((x) => x.id === d.phaseId); if (!g) { g = { id: d.phaseId, n: String(d.phase ?? "").split("·")[0].trim(), items: [] }; groupes.push(g); } g.items.push(d); });
    portes = groupes.map((g) => {
      const ok = g.items.filter((d) => d.state === "filled"), ko = g.items.filter((d) => d.state !== "filled");
      const nom = `${g.n}, ${Object.hasOwn(W.phase, g.id) ? W.phase[g.id] : g.id}`;
      const lignes = ko.map((d) => `<div class="r"><span>${esc(nom)}</span><span><code>${esc(d.relPath)}</code> <span class="soft small">${esc(Object.hasOwn(W.artifact, d.artifact) ? W.artifact[d.artifact] : d.artifact)}</span></span><span>${mk("inv", M.missing)}</span></div>`).join("");
      return `${ok.length ? `<div class="r"><span>${esc(nom)}</span><span class="soft">${M.filled(ok.length)}</span><span class="soft">${etq("full", M.filledOne)}</span></div>` : ""}${lignes}`;
    }).join("");
  }
  let suivant = "";
  if (v === "gaps" && l?.next?.command) suivant = `<div class="suivant"><div><h3>${M.next}</h3><p>${M.nextGaps}</p>${l.next.text ? `<p class="small soft" lang="en">${M.says}${esc(l.next.text)}</p>` : ""}</div><code class="cmd" translate="no">${esc(l.next.command)}</code></div>`;
  if (v === "level-not-met") suivant = `<div class="suivant"><div><h3>${M.next}</h3><p>${M.nextLevel}</p></div>${go("#/proof", M.openProof, { q: true })}</div>`;
  if (v === "not-observed") suivant = `<div class="suivant"><div><h3>${M.next}</h3><p>${st?.consent ? M.nextConsented : M.nextConsent}</p></div>${st?.consent ? etq("full", C.consented) : go(versAccord(st), W.lines.consentInAccess, { q: true })}</div>`;
  const a = st?.accepted;
  // a GitLab upload is ordered by its pipeline, then its job; what the declaration names is the pipeline definition
  const gitlab = st?.forge === "gitlab", G = W.forge;
  const prov = a ? `<dl class="cl2"><dt>${M.file}</dt><dd><code>${esc(sourceDe(m) ?? "")}</code>${l?.runward ? M.writtenBy(esc(l.runward)) : ""}</dd>
      <dt>${M.upload}</dt><dd>${M.receivedOn(esc(a.seq), when(a.receivedAt))}</dd><dt>${gitlab ? esc(G.pipeline) : M.run}</dt><dd>${gitlab ? G.pipelineLine(esc(a.runNumber), esc(a.runAttempt)) : M.runLine(esc(a.runId), esc(a.runNumber), esc(a.runAttempt))}</dd>
      <dt>${gitlab ? esc(G.definition) : M.workflow}</dt><dd><code>${esc(a.workflow)}</code></dd><dt>${M.commit}</dt><dd><code>${esc(a.commit ?? "")}</code></dd>
      <dt>${M.level}</dt><dd>${etq("half", M.declaredOnly(l?.implemented ?? "ci-declared"))}</dd></dl>`
    : `<p class="note">${M.noProv}</p>`;
  const attendus = (m.findings ?? []).filter((f) => f.file).map((f) => `<li><span class="h">${M.expected}</span><span class="m"><span class="mk mk-void" aria-hidden="true"></span></span><span>${M.expectedLine(esc(f.what))}<span class="sub"><code>${esc(f.file)}</code></span></span></li>`).join("");
  // the level of evidence of the path the file took (ADR-0029 section 2), beside runward-fleet's reading and never
  // inside it: the sentence, what it does not prove, then the code; a key since retired; GitLab's order signal
  const chemin = st?.level ? `<section class="sect" aria-labelledby="h-niv"><header><h2 id="h-niv">${esc(G.level.h2)}</h2></header><p class="small soft">${G.level.lead}</p>${niveauLigne(st)}${ordre(st)}</section>` : "";
  const hist = (st?.activity ?? []).map(jLigne).join("");
  const L = lang(), idx = S.index.lang !== L ? { ...S.index, lang: L } : S.index;
  return { title: M.title(nomCourt(m)), key: "fleet", signed: "in", fleetRoute: "mission", html: `<div class="dash mission-d">
    <p class="fil-d small soft"><a href="#/">${W.frame.portfolio}</a> / <a href="#/decision/${esc(m.id)}" translate="no">${esc(nomLong(m))}</a> / <span>${M.technical}</span></p>
    <div>${chipOf(v)}<h1 translate="no">${esc(nomLong(m))}</h1><p class="cause-g">${cause(m)}</p><p class="src">${sourceLigne(m)}</p></div>
    ${suivant}
    ${l && portes ? `<section class="sect" aria-labelledby="h-pp"><header><h2 id="h-pp">${v === "gaps" ? M.h2Missing : M.h2Deliverables}</h2></header><div class="manque">${portes}</div></section>` : ""}
    <section class="sect" aria-labelledby="h-prov"><header><h2 id="h-prov">${M.h2Prov}</h2></header>${prov}</section>
    ${chemin}
    <section class="sect" aria-labelledby="h-hist"><header><h2 id="h-hist">${M.h2Activity}</h2><a href="#/envois">${C.wholeJournal}</a></header>${hist || attendus ? `<ul class="journal-d">${hist}${attendus}</ul>` : `<p class="note">${M.noActivity}</p>`}</section>
    <section class="sect vue-fleet" aria-labelledby="h-vf"><header><h2 id="h-vf">${M.h2View}</h2><span class="rv">${M.viewR}</span></header>${renderView(idx, "mission", m.id)}</section>
  </div>` };
}
