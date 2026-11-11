// Access, sub-screen: one declared repository (#/acces/depot/<id or name>[/accord]). The place a link lands when it
// is about one repository (its first upload to confirm, its consent, its gestures), instead of the top of Accès: where
// it stands and its next gesture first, then its consent, what is declared, and its other gestures. Its gestures are
// the ones of the list in Accès (the same confirmation boxes); once one is done, the screen stays here.
import { S, esc } from "../base.js";
import { when } from "../time.js";
import { mk, head, go } from "../marks.js";
import { mots } from "../lexique.js";
import { ask, confirmBox } from "../confirm.js";
import { depotDe, versSection, versModifier } from "../liens.js";
import { etatDepot } from "./depots.js";

/** Consent not given: giving it is this screen's first gesture, a plain button (the list's is a link). */
const consentir = (id, label) => `<button class="btn" type="button" data-do="ask" data-k="consentir:${esc(id)}" data-focus-key="consentir:${esc(id)}">${esc(label)}</button>`;

export function viewDepot(key, quoi) {
  const W = mots(), A = W.acces, D = A.depots, P = A.depot, C = W.common;
  const r = depotDe(S.access.repositories, key);
  const crumb = (name) => [[A.title, "#/acces"], [D.h2, versSection("depots")], [name, null, true]];
  if (!r || (quoi && quoi !== "accord")) {
    return { title: P.title, key: "acces", signed: "in", crumb: crumb(P.title), html: `${head(P.head, "")}<h1 class="v">${P.goneH1}</h1><p class="face">${P.gone}${key ? ` <code translate="no">${esc(key)}</code>` : ""}</p><div class="actions">${go(versSection("depots"), P.all)}</div>` };
  }
  const removed = r.state === "removed";
  const e = etatDepot(r);
  const text = removed ? P.removed(when(r.restorableUntil, { sec: false }))
    : e.kind === "received" ? P.received
      : e.kind === "owner" ? P.owner
        : e.kind === "pending" ? P.pending
          : r.consent ? P.pinned : P.pinnedNoConsent;
  const etat = `<section class="blk" aria-labelledby="h-depot-etat"><h2 id="h-depot-etat">${P.h2State}</h2>
      <div class="arow"><div>${e.mark}</div><div class="small">${text}</div><div>${removed ? ask(`restorerepo:${r.id}`, C.restore) : e.next}</div>${confirmBox(`restorerepo:${r.id}`)}</div></section>`;
  const accord = removed ? "" : `<section class="blk" aria-labelledby="h-depot-accord"><h2 id="h-depot-accord">${P.h2Consent}</h2>
      <div class="arow"><div>${r.consent ? mk("full", C.consented) : mk("void", D.notConsented)}</div><div class="small">${r.consent ? P.consentYes : P.consentNo}</div><div id="depot-accord">${r.consent ? ask(`consent:${r.id}`, D.withdraw) : consentir(r.id, D.consent)}</div>${confirmBox(`consent:${r.id}`)}${confirmBox(`consentir:${r.id}`)}</div></section>`;
  const missions = r.missions.map((m) => `<code>${esc(m.id)}</code> <span class="soft">${esc(m.path)}</span>`).join(", ");
  const declare = `<section class="blk" aria-labelledby="h-depot-decl"><h2 id="h-depot-decl">${P.h2Declared}</h2>
      <div class="arow"><div><span class="k">${D.missions}</span>${missions}</div><div class="small"><span class="k">${D.workflow}</span><code>${esc(r.workflow)}</code>${D.on}<code>main</code>${r.repositoryId ? `<br><span class="k">${D.pinnedId}</span><code>${esc(r.repositoryId)}</code>` : ""}</div><div></div></div></section>`;
  const autres = removed ? "" : `<section class="blk" aria-labelledby="h-depot-autres"><h2 id="h-depot-autres">${P.h2Other}</h2>
      <div class="actions">${go(versModifier(r.id), D.modify, { q: true })}${ask(`purge:${r.id}`, D.erase)}${ask(`repo:${r.id}`, C.remove)}</div>${confirmBox(`purge:${r.id}`)}${confirmBox(`repo:${r.id}`)}</section>`;
  // the consent named by the address takes the focus, and is shown for a moment (web/views/shell.js#arrival)
  const cible = quoi === "accord" && !removed ? "#depot-accord button" : null;
  return { title: r.name, key: "acces", signed: "in", crumb: crumb(r.name), focus: cible, cible, html: `${head(P.head, A.headR)}
    <h1 class="v" data-verbatim translate="no">${esc(r.name)}</h1>
    <div class="reglages">${etat}
    ${accord}
    ${declare}
    ${autres}</div>
    <div class="actions">${go(versSection("depots"), P.all, { q: true })}</div>` };
}
