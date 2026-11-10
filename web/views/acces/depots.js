// Access, section: the declared repositories, their consent and their content.
import { esc } from "../base.js";
import { when } from "../time.js";
import { mk, go } from "../marks.js";
import { ask, confirmBox } from "../confirm.js";

/** The declared repositories. */
export function sectionDepots(a) {
  const rp = a.repositories.map((r) => {
    const removed = r.state === "removed";
    const missions = r.missions.map((m) => `<code>${esc(m.id)}</code> <span class="soft">${esc(m.path)}</span>`).join(", ");
    const consentBtn = removed ? "" : r.consent ? ask(`consent:${r.id}`, "Retirer le consentement", false) : ask(`consentir:${r.id}`, "Consentir au contenu", false);
    const state = removed ? "" : r.state === "pending" ? `${mk("half", "en attente du premier envoi")}${r.pendingSend ? ` · <a href="#/declarer/confirmer/${esc(r.id)}">confirmer le premier envoi</a>` : ""}<br>` : r.pendingSend?.reason === "owner-changed" ? `${mk("inv", "owner-changed")} · <a href="#/declarer/confirmer/${esc(r.id)}">confirmer le nouveau propriétaire</a><br>` : "";
    return `<div class="arow"><div><div class="nm" data-verbatim translate="no">${esc(r.name)}</div><span class="k">missions</span>${missions}${r.repositoryId ? `<span class="k">identifiant épinglé</span><code>${esc(r.repositoryId)}</code>` : ""}</div>
      <div class="small">${state}<span class="k">workflow appelant</span><code>${esc(r.workflow)}</code> sur <code>main</code><br>${removed ? "" : r.consent ? mk("full", "contenu consenti") : mk("void", "contenu non consenti : aucun envoi accepté")}<br>${consentBtn}${removed ? "" : ` · ${ask(`purge:${r.id}`, "Effacer le contenu reçu", false)} · <button class="lien-btn" type="button" data-go="#/declarer/modifier/${esc(r.id)}">Modifier</button>`}</div>
      ${removed ? `<div>${mk("void", "retiré")} ${ask(`restorerepo:${r.id}`, "Remettre")}<div class="small soft">possible jusqu'au ${when(r.restorableUntil, { sec: false })}</div></div>` : `<div>${ask(`repo:${r.id}`, "Retirer")}</div>`}
      ${confirmBox(`repo:${r.id}`)}${confirmBox(`restorerepo:${r.id}`)}${confirmBox(`consent:${r.id}`)}${confirmBox(`consentir:${r.id}`)}${confirmBox(`purge:${r.id}`)}</div>`;
  }).join("") || `<p class="small soft">Aucun dépôt déclaré.</p>`;
  return `<section class="blk"><h2>Dépôts déclarés</h2>${rp}<div class="actions" style="margin-top:12px">${go("#/declarer", "Déclarer un dépôt", { q: true })}</div></section>`;
}
