// The dashboard of the fleet (signed in), at #/flotte: the uploads, the provenance and the activity. Since the
// decision reading became the screen a member lands on (web/views/decision.js), it is one of the technical views.
import { S, esc, short } from "./base.js";
import { hm, day } from "./time.js";
import { go, etq, mk } from "./marks.js";
import { mots, titreFlotte } from "./lexique.js";
import { provLigne, jLigne, comptes, triees, verdictOf, chipOf, nomLong, cause, sourceLigne, geste, etatOf, ligne, porte } from "./lignes.js";

export function viewFlotte() {
  const W = mots(), T = W.flotte, C = W.common, V = W.verdict;
  const s = S.session;
  const title = esc(titreFlotte(s.tenant.title));
  if (!S.index) {
    return { title: W.fleet.title, key: "fleet", signed: "in", fleetRoute: "flotte", html: `<div class="dash"><div class="titre-d"><div><h1>${title}</h1><p class="rv">${provLigne()}</p></div><div class="actions">${go("#/declarer", C.declare)}</div></div>
      <section class="sect"><h2>${C.noMission}</h2><p class="note">${C.noMissionText}</p></section>
      ${S.status?.recent?.length ? `<section class="sect" aria-labelledby="h-act"><header><h2 id="h-act">${C.recentActivity}</h2><a href="#/envois">${C.wholeJournal}</a></header><ul class="journal-d">${S.status.recent.map(jLigne).join("")}</ul></section>` : ""}</div>` };
  }
  const N = comptes();
  const attente = triees().filter((m) => verdictOf(m) !== "clean");
  const lignesAtt = attente.map((m) => `<div class="att-r">
      <div>${chipOf(verdictOf(m))}</div>
      <div><p class="nm"><a href="#/mission/${esc(m.id)}" translate="no">${esc(nomLong(m))}</a></p><p class="cause">${cause(m)}</p><p class="src">${sourceLigne(m)}</p></div>
      <div class="geste">${geste(m)}</div></div>`).join("");
  const lignesMis = triees().map((m) => {
    const v = verdictOf(m), [sh, w] = etatOf(v), st = ligne(m.id), l = typeof m.latest === "object" ? m.latest : null;
    const sous = l ? `${porte(l.currentGate)} · ${l.adrCount ?? 0} ADR` : T.noVerdict;
    const env = st?.accepted ? `${W.lines.entry(esc(st.accepted.seq))}, ${hm(st.accepted.receivedAt)}<span class="sub hash">${esc(String(st.accepted.commit ?? "").slice(0, 12))}</span>` : `<span class="soft">${T.none}</span>`;
    const niv = l ? etq("half", l.implemented) : etq("void", T.notObserved);
    return `<a class="r" href="#/mission/${esc(m.id)}"><span><span class="nm" translate="no">${esc(nomLong(m))}</span><span class="sub">${esc(sous)}</span></span><span>${etq(sh, w)}</span><span class="soft">${env}</span><span class="soft">${niv}</span></a>`;
  }).join("");
  const first = (v) => attente.find((m) => verdictOf(m) === v)?.id;
  const cpt = (v, n, chip) => { const id = first(v); return id ? `<a href="#/mission/${esc(id)}"><span class="v">${n}</span>${chip}</a>` : `<span class="cpt"><span class="v">${n}</span>${chip}</span>`; };
  const recent = S.status?.recent ?? [];
  const jour = recent[0]?.at ? day(recent[0].at) : "";
  return { title: W.fleet.title, key: "fleet", signed: "in", fleetRoute: "flotte", html: `<div class="dash">
    <div class="titre-d"><div><h1>${title}</h1><p class="rv">${provLigne()}</p></div>
      <div class="actions">${go("#/acces/export", T.exportAct, { q: true })}${go("#/declarer", C.declare)}</div></div>
    ${S.status?.quarantined ? `<p class="avert">${mk("inv", C.notPublished)} ${C.quarantined(esc(S.status.quarantined))} <a href="#/envois">${C.seeUploads}</a></p>` : ""}
    <nav class="compteurs" aria-label="${esc(T.byState)}">
      ${cpt("gaps", N.gaps, etq("inv", N.gaps > 1 ? V.gapsMany : V.gaps))}${cpt("level-not-met", N.lnm, etq("inv", V["level-not-met"]))}${cpt("not-observed", N.silent, etq("void", N.silent > 1 ? V.silentMany : V["not-observed"]))}
      <a href="#/vue"><span class="v">${N.clean}</span>${etq("full", V.clean)}</a></nav>
    <section class="sect" aria-labelledby="h-att"><header><h2 id="h-att">${T.awaits} <span>${attente.length}</span></h2></header>
      ${attente.length ? `<div class="attente">${lignesAtt}</div>` : `<p class="note">${T.nothingAwaits}</p>`}</section>
    <div class="duo-d">
      <section class="sect" aria-labelledby="h-mis"><header><h2 id="h-mis">${T.missions} <span>${N.N}</span></h2><a href="#/history">${W.frame.views.history}</a></header>
        <div class="ml"><div class="r h" aria-hidden="true">${T.th.map((h) => `<span>${h}</span>`).join("")}</div>${lignesMis}</div></section>
      <section class="sect" aria-labelledby="h-act"><header><h2 id="h-act">${C.recentActivity}</h2><a href="#/envois">${C.wholeJournal}</a></header>
        ${jour ? `<p class="jour">${esc(jour)}</p>` : ""}<ul class="journal-d">${recent.map(jLigne).join("")}</ul></section>
    </div>
    <div class="recalc"><p class="small soft">${T.recalc(esc(short(S.status?.index?.sha256)), `/f/${esc(s.tenant.id)}/index.json`)}</p></div>
  </div>` };
}
