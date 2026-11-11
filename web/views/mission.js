// A mission: cause, the next gesture, what is missing gate by gate, where the verdict comes from, its
// activity, then its runward-fleet view.
import { S, esc } from "./base.js";
import { when } from "./time.js";
import { mk, etq, go } from "./marks.js";
import { renderView } from "./fleet-views.js";
import { verdictOf, ligne, PHASE_FR, ART_FR, sourceDe, jLigne, nomCourt, nomLong, chipOf, cause, sourceLigne } from "./lexique.js";

export function viewMissionDetail(id) {
  if (!S.index) return null;
  const m = S.index.missions.find((x) => x.id === id);
  if (!m) return null;
  const v = verdictOf(m), st = ligne(m.id), l = typeof m.latest === "object" ? m.latest : null;
  let portes = "";
  if (l) {
    const groupes = [];
    (l.deliverables?.list ?? []).forEach((d) => { let g = groupes.find((x) => x.id === d.phaseId); if (!g) { g = { id: d.phaseId, n: String(d.phase ?? "").split("·")[0].trim(), items: [] }; groupes.push(g); } g.items.push(d); });
    portes = groupes.map((g) => {
      const ok = g.items.filter((d) => d.state === "filled"), ko = g.items.filter((d) => d.state !== "filled");
      const nom = `${g.n}, ${PHASE_FR[g.id] ?? g.id}`;
      const lignes = ko.map((d) => `<div class="r"><span>${esc(nom)}</span><span><code>${esc(d.relPath)}</code> <span class="soft small">${esc(ART_FR[d.artifact] ?? d.artifact)}</span></span><span>${mk("inv", "manquant")}</span></div>`).join("");
      return `${ok.length ? `<div class="r"><span>${esc(nom)}</span><span class="soft">${ok.length} livrable${ok.length > 1 ? "s" : ""} rempli${ok.length > 1 ? "s" : ""}</span><span class="soft">${etq("full", "rempli")}</span></div>` : ""}${lignes}`;
    }).join("");
  }
  let suivant = "";
  if (v === "gaps" && l?.next?.command) suivant = `<div class="suivant"><div><h3>Geste suivant</h3><p>Écrire le livrable qui manque à la porte où la mission bute, puis relancer <code>runward check --strict</code>.</p>${l.next.text ? `<p class="small soft" lang="en">runward : ${esc(l.next.text)}</p>` : ""}</div><code class="cmd" translate="no">${esc(l.next.command)}</code></div>`;
  if (v === "level-not-met") suivant = `<div class="suivant"><div><h3>Geste suivant</h3><p>Ouvrir la preuve de la flotte : elle sépare ce qui est vérifié mécaniquement de ce qui n'est que déclaré par la CI.</p></div>${go("#/proof", "Ouvrir la preuve", { q: true })}</div>`;
  if (v === "not-observed") suivant = `<div class="suivant"><div><h3>Geste suivant</h3><p>${st?.consent ? "Le contenu de ce dépôt est consenti : le prochain envoi accepté fera entrer la mission dans l'index." : "Consentir au contenu de ce dépôt. Sans cet accord, aucun envoi n'est accepté, attestation comprise."}</p></div>${st?.consent ? etq("full", "contenu consenti") : go("#/acces", "Consentir dans Accès", { q: true })}</div>`;
  const a = st?.accepted;
  const prov = a ? `<dl class="cl2"><dt>fichier</dt><dd><code>${esc(sourceDe(m) ?? "")}</code>${l?.runward ? `, écrit par runward ${esc(l.runward)}` : ""}</dd>
      <dt>envoi</dt><dd>entrée ${esc(a.seq)}, reçue le ${when(a.receivedAt)}</dd><dt>run</dt><dd>${esc(a.runId)}, n° ${esc(a.runNumber)}, tentative ${esc(a.runAttempt)}</dd>
      <dt>workflow appelant</dt><dd><code>${esc(a.workflow)}</code></dd><dt>commit</dt><dd><code>${esc(a.commit ?? "")}</code></dd>
      <dt>niveau de preuve</dt><dd>${etq("half", `${l?.implemented ?? "ci-declared"} : déclaré par la CI, rien de plus`)}</dd></dl>`
    : `<p class="note">Aucun envoi accepté : il n'y a pas encore de verdict, donc pas de provenance à montrer.</p>`;
  const attendus = (m.findings ?? []).filter((f) => f.file).map((f) => `<li><span class="h">attendu</span><span class="m"><span class="mk mk-void" aria-hidden="true"></span></span><span>${esc(f.what)} attendu par l'inventaire, absent<span class="sub"><code>${esc(f.file)}</code></span></span></li>`).join("");
  const hist = (st?.activity ?? []).map(jLigne).join("");
  return { title: `Mission ${nomCourt(m)}`, key: "fleet", signed: "in", fleetRoute: "mission", html: `<div class="dash mission-d">
    <p class="fil-d small soft"><a href="#/">Portefeuille</a> / <a href="#/decision/${esc(m.id)}" translate="no">${esc(nomLong(m))}</a> / <span>détail technique</span></p>
    <div>${chipOf(v)}<h1 translate="no">${esc(nomLong(m))}</h1><p class="cause-g">${cause(m)}</p><p class="src">${sourceLigne(m)}</p></div>
    ${suivant}
    ${l && portes ? `<section class="sect" aria-labelledby="h-pp"><header><h2 id="h-pp">${v === "gaps" ? "Ce qui manque, porte par porte" : "Livrables, porte par porte"}</h2></header><div class="manque">${portes}</div></section>` : ""}
    <section class="sect" aria-labelledby="h-prov"><header><h2 id="h-prov">D'où vient ce verdict</h2></header>${prov}</section>
    <section class="sect" aria-labelledby="h-hist"><header><h2 id="h-hist">Activité de la mission</h2><a href="#/envois">Tout le journal</a></header>${hist || attendus ? `<ul class="journal-d">${hist}${attendus}</ul>` : `<p class="note">Aucune activité pour cette mission.</p>`}</section>
    <section class="sect vue-fleet" aria-labelledby="h-vf"><header><h2 id="h-vf">La vue runward-fleet de cette mission</h2><span class="rv">telle que runward-fleet build la construit</span></header>${renderView(S.index, "mission", m.id)}</section>
  </div>` };
}
