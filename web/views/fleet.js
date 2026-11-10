// Fleet: provenance and the status line, then views.js.
import { S, esc, short } from "./base.js";
import { when } from "./time.js";
import { mk, head, reqNote, act, go, loadingView } from "./marks.js";
import { renderView } from "./fleet-views.js";
import { viewFlotte } from "./flotte.js";
import { viewMissionDetail } from "./mission.js";

function fleetHead() {
  const st = S.status;
  if (!st) return "";
  const lines = st.lines.map((m) => {
    const last = m.accepted ? `${mk("full", `entrée ${m.accepted.seq}`)}<div class="small">${when(m.accepted.receivedAt)}</div>` : m.state === "pending" ? mk("half", "en attente de confirmation") : mk("void", "aucun envoi accepté");
    const cur = m.accepted ? `<span class="small">run <b>${esc(m.accepted.runNumber)}</b> · tentative ${esc(m.accepted.runAttempt)}</span><div><code>${esc(String(m.accepted.commit ?? "").slice(0, 12))}</code></div>` : `<span class="soft small">rien</span>`;
    const since = m.notAcceptedSince ? `${mk("inv", `${m.notAcceptedSince} non accepté${m.notAcceptedSince > 1 ? "s" : ""} depuis`)}<div class="small"><code>${esc(m.lastRefusal)}</code> · <a href="#/envois">voir les envois</a></div>` : `<span class="small soft">0 non accepté depuis</span>`;
    return `<tr><th scope="row"><span data-verbatim translate="no">${esc(m.mission)}</span><div class="small soft" translate="no">${esc(m.repository)}</div></th><td>${last}</td><td>${cur}</td><td>${since}</td></tr>`;
  }).join("");
  const idx = st.index;
  return `${head(idx ? `index servi · sha256 <b>${esc(short(idx.sha256))}</b> · runward-fleet ${esc(idx.fleetVersion)} · assemblé le <b>${when(idx.publishedAt)}</b>, heure du service (déclarée), à l'entrée ${idx.seq}` : "aucun index publié", "rien n'est élevé par ce service : ci-declared au plus")}
    ${idx ? `<div class="prov-tete small"><a href="/f/${esc(S.session.tenant.id)}/index.json">index.json, tel que servi</a> · recalculer chez vous depuis l'archive : <code translate="no">runward-fleet build fleet.json --out site</code> redonne <code>${esc(short(idx.sha256))}</code></div>` : ""}
    ${st.quarantined ? `<p class="avert">${mk("inv", "non publié")} ${st.quarantined} envoi${st.quarantined > 1 ? "s" : ""} en quarantaine : la flotte montre le dernier index publié. <a href="#/envois">Voir les envois</a></p>` : ""}
    ${lines ? `<section class="blk releve" aria-label="Relevé des envois par mission"><details class="releve-d"${matchMedia("(min-width: 760px)").matches ? " open" : ""}>
      <summary><h2 class="h-releve">Envois par mission</h2> <span class="small soft">${st.lines.length} mission${st.lines.length > 1 ? "s" : ""}, ${st.lines.filter((m) => m.notAcceptedSince).length} avec un envoi non accepté, ${st.lines.filter((m) => !m.accepted).length} sans aucun envoi accepté</span></summary>
      <div class="tw" tabindex="0" role="region" aria-label="Relevé des envois par mission, défilable"><table class="t"><thead><tr><th scope="col">Mission</th><th scope="col">Dernier envoi accepté</th><th scope="col">Envoi courant</th><th scope="col">Non acceptés depuis</th></tr></thead><tbody>${lines}</tbody></table></div>
      <p class="small soft">« Non accepté » parle de l'envoi au service ; « refusée » parle du verdict de runward, dans la vue ci-dessous. L'envoi courant est celui du plus grand numéro de run : une relance d'un run ancien reste historique.</p></details></section>` : ""}`;
}
export function viewFleet(route, sub) {
  if (S.fleetError) return { title: "Flotte injoignable", key: "fleet", signed: "in", html: `${head("runward hébergé · état du service", "")}<h1 class="v">La flotte ne s'affiche pas.</h1><p class="face">${mk("inv", "non affichée")} Votre session est ouverte, mais l'index n'a pas pu être lu. Le journal, lui, s'affiche.${reqNote(S.fleetError)}</p><div class="actions">${act("reload-screen", "Réessayer")}${go("#/envois", "Voir les envois", { q: true })}</div>` };
  if (!S.status) return loadingView("Flotte");
  if (route === "") return viewFlotte();
  if (route === "mission") return viewMissionDetail(sub);
  if (!S.index) return { title: "Flotte", key: "fleet", signed: "in", fleetRoute: route, html: `${fleetHead()}<h1 class="v">Aucune mission publiée.</h1><p>Votre flotte compte les dépôts que vous déclarez, et seulement ceux-là. Une mission apparaît après son premier envoi confirmé.</p><div class="actions">${go("#/declarer", "Déclarer un dépôt")}</div>` };
  const titles = { vue: "Vue complète", history: "Historique", proof: "Preuve", signatures: "Signatures", pr: "Dans la PR", sources: "Sources" };
  return { title: titles[route] ?? "Flotte", key: "fleet", signed: "in", fleetRoute: route, html: `${fleetHead()}${renderView(S.index, route === "vue" ? "" : route, sub || undefined)}` };
}
