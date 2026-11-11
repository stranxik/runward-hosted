// Access, section: the member's passkeys.
import { esc } from "../base.js";
import { when, DTF } from "../time.js";
import { mk, go } from "../marks.js";
import { ancre, titreAncre } from "../liens.js";
import { mots, appareil } from "../lexique.js";
import { ask, confirmBox } from "../confirm.js";

/** The passkeys: the live ones, the removed ones that can still be restored. */
export function sectionPasskeys(a) {
  const W = mots(), P = W.acces.passkeys, C = W.common;
  const live = a.passkeys.filter((p) => !p.removedAt);
  const pk = a.passkeys.map((p) => {
    const name = appareil(p.provider ?? p.device) ?? P.name;
    const removed = Boolean(p.removedAt);
    const right = removed
      ? `<div>${mk("void", P.removed)} ${ask(`restore:${p.id}`, C.restore)}<div class="small soft">${C.until(when(p.restorableUntil, { sec: false }))}</div></div>`
      : live.length === 1 ? `<div class="small soft">${P.last}</div>` : `<div>${ask(`passkey:${p.id}`, C.remove)}</div>`;
    return `<div class="arow"><div><div class="nm">${esc(name)}${p.current ? P.opensThis : ""}</div><span class="k">${[p.phone ? C.phoneQr : null, p.synced === true ? C.synced : p.synced === false ? C.boundHere : null, P.addedOn(DTF.format(new Date(p.createdAt)).slice(0, 10))].filter(Boolean).map(esc).join(" · ")}</span></div>
      <div class="small"><span class="k">${P.lastUsed}</span>${when(p.lastUsedAt, { sec: false })}</div>${right}${confirmBox(`passkey:${p.id}`)}${confirmBox(`restore:${p.id}`)}</div>`;
  }).join("");
  const same = a.sameProvider ? `<p class="avert">${P.same}</p>` : "";
  return `<section class="blk"${ancre("cles")}><h2${titreAncre("cles")}>${P.h2}</h2>${pk}${same}<div class="actions" style="margin-top:12px">${go("#/acces/ajout", W.frame.addPasskey, { q: true })}</div></section>`;
}
