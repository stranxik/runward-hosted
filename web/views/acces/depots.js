// Access, section: the declared repositories, their consent and their content. Each name opens the repository's
// own screen (#/acces/depot/<id>, web/views/acces/depot.js), where a link from elsewhere lands.
import { esc } from "../base.js";
import { when } from "../time.js";
import { mk, go } from "../marks.js";
import { mots } from "../lexique.js";
import { ask, confirmBox } from "../confirm.js";
import { ancre, titreAncre, versDepot, versConfirmer, versAttente, versModifier } from "../liens.js";

/**
 * Where a repository stands, as its mark and its next gesture: removed; its first upload arrived, to confirm (the
 * service keeps it, `pendingSend`, src/application/ingest.js), said with its date; a new owner to confirm; waiting
 * for its first upload, with the date its declaration expires; confirmed, with its date.
 */
export function etatDepot(r) {
  const W = mots(), D = W.acces.depots, C = W.common;
  if (r.state === "removed") return { kind: "removed", mark: mk("void", D.removed), next: "" };
  if (r.pendingSend?.reason === "owner-changed") return { kind: "owner", mark: mk("inv", D.ownerChanged), next: go(versConfirmer(r.id), D.confirmOwner) };
  if (r.state === "pending" && r.pendingSend) return { kind: "received", mark: `${mk("half", C.firstReceived)} <span class="soft">${C.toConfirm(when(r.pendingSend.receivedAt, { sec: false }))}</span>`, next: go(versConfirmer(r.id), D.confirmFirst), at: r.pendingSend.receivedAt };
  if (r.state === "pending") return { kind: "pending", mark: `${mk("half", C.waitingFirst)} <span class="soft">· ${D.expires(when(r.expiresAt, { sec: false }))}</span>`, next: go(versAttente(r.id), D.seeSnippet, { q: true }) };
  return { kind: "pinned", mark: `${mk("full", D.confirmed)} <span class="soft">· ${D.dated(when(r.confirmedAt, { sec: false }))}</span>`, next: "" };
}

/** The declared repositories. */
export function sectionDepots(a) {
  const W = mots(), D = W.acces.depots, C = W.common;
  const rp = a.repositories.map((r) => {
    const removed = r.state === "removed";
    const e = etatDepot(r);
    const missions = r.missions.map((m) => `<code>${esc(m.id)}</code> <span class="soft">${esc(m.path)}</span>`).join(", ");
    const consentBtn = removed ? "" : r.consent ? ask(`consent:${r.id}`, D.withdraw, false) : ask(`consentir:${r.id}`, D.consent, false);
    const state = removed ? "" : `${e.mark}${e.next ? `<div class="actions etat-geste">${e.next}</div>` : "<br>"}`;
    return `<div class="arow" id="depot-${esc(r.id)}"><div><div class="nm" data-verbatim translate="no"><a href="${esc(versDepot(r.id))}">${esc(r.name)}</a></div><span class="k">${D.missions}</span>${missions}${r.repositoryId ? `<span class="k">${D.pinnedId}</span><code>${esc(r.repositoryId)}</code>` : ""}</div>
      <div class="small">${state}<span class="k">${D.workflow}</span><code>${esc(r.workflow)}</code>${D.on}<code>main</code><br>${removed ? "" : r.consent ? mk("full", C.consented) : mk("void", D.notConsented)}<br>${consentBtn}${removed ? "" : ` · ${ask(`purge:${r.id}`, D.erase, false)} · <button class="lien-btn" type="button" data-go="${esc(versModifier(r.id))}">${D.modify}</button>`}</div>
      ${removed ? `<div>${mk("void", D.removed)} ${ask(`restorerepo:${r.id}`, C.restore)}<div class="small soft">${C.until(when(r.restorableUntil, { sec: false }))}</div></div>` : `<div>${ask(`repo:${r.id}`, C.remove)}</div>`}
      ${confirmBox(`repo:${r.id}`)}${confirmBox(`restorerepo:${r.id}`)}${confirmBox(`consent:${r.id}`)}${confirmBox(`consentir:${r.id}`)}${confirmBox(`purge:${r.id}`)}</div>`;
  }).join("") || `<p class="small soft">${D.none}</p>`;
  return `<section class="blk"${ancre("depots")}><h2${titreAncre("depots")}>${D.h2}</h2>${rp}<div class="actions" style="margin-top:12px">${go("#/declarer", C.declare, { q: true })}</div></section>`;
}
