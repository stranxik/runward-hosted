// The dashboard of the fleet (signed in).
import { S, esc, short } from "./base.js";
import { hm, DAY_FR } from "./time.js";
import { go, etq, mk } from "./marks.js";
import { provLigne, jLigne, comptes, triees, verdictOf, chipOf, nomLong, cause, sourceLigne, geste, VERDICT_FR, ligne, porteFr } from "./lexique.js";

export function viewFlotte() {
  const s = S.session;
  if (!S.index) {
    return { title: "Flotte", key: "fleet", signed: "in", fleetRoute: "", html: `<div class="dash"><div class="titre-d"><div><h1>${esc(s.tenant.title)}</h1><p class="rv">${provLigne()}</p></div><div class="actions">${go("#/declarer", "Déclarer un dépôt")}</div></div>
      <section class="sect"><h2>Aucune mission publiée.</h2><p class="note">Votre flotte compte les dépôts que vous déclarez, et seulement ceux-là. Une mission apparaît après son premier envoi confirmé.</p></section>
      ${S.status?.recent?.length ? `<section class="sect" aria-labelledby="h-act"><header><h2 id="h-act">Activité récente</h2><a href="#/envois">Tout le journal</a></header><ul class="journal-d">${S.status.recent.map(jLigne).join("")}</ul></section>` : ""}</div>` };
  }
  const N = comptes();
  const attente = triees().filter((m) => verdictOf(m) !== "clean");
  const lignesAtt = attente.map((m) => `<div class="att-r">
      <div>${chipOf(verdictOf(m))}</div>
      <div><p class="nm"><a href="#/mission/${esc(m.id)}" translate="no">${esc(nomLong(m))}</a></p><p class="cause">${cause(m)}</p><p class="src">${sourceLigne(m)}</p></div>
      <div class="geste">${geste(m)}</div></div>`).join("");
  const lignesMis = triees().map((m) => {
    const v = verdictOf(m), [sh, w] = VERDICT_FR[v] ?? VERDICT_FR["not-observed"], st = ligne(m.id), l = typeof m.latest === "object" ? m.latest : null;
    const sous = l ? `${porteFr(l.currentGate)} · ${l.adrCount ?? 0} ADR` : "aucun verdict reçu";
    const env = st?.accepted ? `entrée ${esc(st.accepted.seq)}, ${hm(st.accepted.receivedAt)}<span class="sub hash">${esc(String(st.accepted.commit ?? "").slice(0, 12))}</span>` : `<span class="soft">aucun</span>`;
    const niv = l ? etq("half", l.implemented) : etq("void", "non observé");
    return `<a class="r" href="#/mission/${esc(m.id)}"><span><span class="nm" translate="no">${esc(nomLong(m))}</span><span class="sub">${esc(sous)}</span></span><span>${etq(sh, w)}</span><span class="soft">${env}</span><span class="soft">${niv}</span></a>`;
  }).join("");
  const first = (v) => attente.find((m) => verdictOf(m) === v)?.id;
  const cpt = (v, n, chip) => { const id = first(v); return id ? `<a href="#/mission/${esc(id)}"><span class="v">${n}</span>${chip}</a>` : `<span class="cpt"><span class="v">${n}</span>${chip}</span>`; };
  const recent = S.status?.recent ?? [];
  const jour = recent[0]?.at ? DAY_FR.format(new Date(recent[0].at)) : "";
  return { title: "Flotte", key: "fleet", signed: "in", fleetRoute: "", html: `<div class="dash">
    <div class="titre-d"><div><h1>${esc(s.tenant.title)}</h1><p class="rv">${provLigne()}</p></div>
      <div class="actions">${go("#/acces/export", "Exporter", { q: true })}${go("#/declarer", "Déclarer un dépôt")}</div></div>
    ${S.status?.quarantined ? `<p class="avert">${mk("inv", "non publié")} ${S.status.quarantined} envoi${S.status.quarantined > 1 ? "s" : ""} en quarantaine : la flotte montre le dernier index publié. <a href="#/envois">Voir les envois</a></p>` : ""}
    <nav class="compteurs" aria-label="Missions par état">
      ${cpt("gaps", N.gaps, etq("inv", N.gaps > 1 ? "refusées" : "refusée"))}${cpt("level-not-met", N.lnm, etq("inv", "niveau non atteint"))}${cpt("not-observed", N.silent, etq("void", N.silent > 1 ? "silencieuses" : "silencieuse"))}
      <a href="#/vue"><span class="v">${N.clean}</span>${etq("full", "sans écart")}</a></nav>
    <section class="sect" aria-labelledby="h-att"><header><h2 id="h-att">Ce qui vous attend <span>${attente.length}</span></h2></header>
      ${attente.length ? `<div class="attente">${lignesAtt}</div>` : `<p class="note">Rien ne vous attend : chaque mission déclarée est sans écart.</p>`}</section>
    <div class="duo-d">
      <section class="sect" aria-labelledby="h-mis"><header><h2 id="h-mis">Missions <span>${N.N}</span></h2><a href="#/history">Historique</a></header>
        <div class="ml"><div class="r h" aria-hidden="true"><span>Mission</span><span>État</span><span>Dernier envoi accepté</span><span>Preuve</span></div>${lignesMis}</div></section>
      <section class="sect" aria-labelledby="h-act"><header><h2 id="h-act">Activité récente</h2><a href="#/envois">Tout le journal</a></header>
        ${jour ? `<p class="jour">${esc(jour)}</p>` : ""}<ul class="journal-d">${recent.map(jLigne).join("")}</ul></section>
    </div>
    <div class="recalc"><p class="small soft">Cette vue est l'index <code>${esc(short(S.status?.index?.sha256))}</code>, servi tel quel : <a href="/f/${esc(s.tenant.id)}/index.json">index.json</a>. Sur l'archive exportée, <code translate="no">runward-fleet build fleet.json --out site</code> le reconstruit chez vous. La vue runward-fleet complète : <a href="#/vue">Vue complète</a>. Rien n'est élevé par ce service : ci-declared au plus.</p></div>
  </div>` };
}
