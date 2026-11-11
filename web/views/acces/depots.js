// Access, section: the declared repositories, their consent and their content.
import { esc } from "../base.js";
import { when } from "../time.js";
import { mk, go } from "../marks.js";
import { mots } from "../lexique.js";
import { ask, confirmBox } from "../confirm.js";

/** The declared repositories. */
export function sectionDepots(a) {
  const W = mots(), D = W.acces.depots, C = W.common;
  const rp = a.repositories.map((r) => {
    const removed = r.state === "removed";
    const missions = r.missions.map((m) => `<code>${esc(m.id)}</code> <span class="soft">${esc(m.path)}</span>`).join(", ");
    const consentBtn = removed ? "" : r.consent ? ask(`consent:${r.id}`, D.withdraw, false) : ask(`consentir:${r.id}`, D.consent, false);
    const state = removed ? "" : r.state === "pending" ? `${mk("half", C.waitingFirst)}${r.pendingSend ? ` · <a href="#/declarer/confirmer/${esc(r.id)}">${D.confirmFirst}</a>` : ""}<br>` : r.pendingSend?.reason === "owner-changed" ? `${mk("inv", "owner-changed")} · <a href="#/declarer/confirmer/${esc(r.id)}">${D.confirmOwner}</a><br>` : "";
    return `<div class="arow"><div><div class="nm" data-verbatim translate="no">${esc(r.name)}</div><span class="k">${D.missions}</span>${missions}${r.repositoryId ? `<span class="k">${D.pinnedId}</span><code>${esc(r.repositoryId)}</code>` : ""}</div>
      <div class="small">${state}<span class="k">${D.workflow}</span><code>${esc(r.workflow)}</code>${D.on}<code>main</code><br>${removed ? "" : r.consent ? mk("full", C.consented) : mk("void", D.notConsented)}<br>${consentBtn}${removed ? "" : ` · ${ask(`purge:${r.id}`, D.erase, false)} · <button class="lien-btn" type="button" data-go="#/declarer/modifier/${esc(r.id)}">${D.modify}</button>`}</div>
      ${removed ? `<div>${mk("void", D.removed)} ${ask(`restorerepo:${r.id}`, C.restore)}<div class="small soft">${C.until(when(r.restorableUntil, { sec: false }))}</div></div>` : `<div>${ask(`repo:${r.id}`, C.remove)}</div>`}
      ${confirmBox(`repo:${r.id}`)}${confirmBox(`restorerepo:${r.id}`)}${confirmBox(`consent:${r.id}`)}${confirmBox(`consentir:${r.id}`)}${confirmBox(`purge:${r.id}`)}</div>`;
  }).join("") || `<p class="small soft">${D.none}</p>`;
  return `<section class="blk"><h2>${D.h2}</h2>${rp}<div class="actions" style="margin-top:12px">${go("#/declarer", C.declare, { q: true })}</div></section>`;
}
