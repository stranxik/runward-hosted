// Access, section: the member's passkeys.
import { esc } from "../base.js";
import { when, DTF } from "../time.js";
import { mk, go } from "../marks.js";
import { ask, confirmBox } from "../confirm.js";

/** The passkeys: the live ones, the removed ones that can still be restored. */
export function sectionPasskeys(a) {
  const live = a.passkeys.filter((p) => !p.removedAt);
  const pk = a.passkeys.map((p) => {
    const name = p.provider ?? p.device ?? "Passkey";
    const removed = Boolean(p.removedAt);
    const right = removed
      ? `<div>${mk("void", "retirée")} ${ask(`restore:${p.id}`, "Remettre")}<div class="small soft">possible jusqu'au ${when(p.restorableUntil, { sec: false })}</div></div>`
      : live.length === 1 ? `<div class="small soft">Votre dernière passkey ne se retire pas : ajoutez-en une autre d'abord.</div>` : `<div>${ask(`passkey:${p.id}`, "Retirer")}</div>`;
    return `<div class="arow"><div><div class="nm">${esc(name)}${p.current ? " · ouvre cette session" : ""}</div><span class="k">${[p.phone ? "téléphone, par QR code" : null, p.synced === true ? "synchronisée" : p.synced === false ? "liée à cet appareil" : null, `ajoutée le ${DTF.format(new Date(p.createdAt)).slice(0, 10)}`].filter(Boolean).map(esc).join(" · ")}</span></div>
      <div class="small"><span class="k">dernière utilisation, heure du service (déclarée)</span>${when(p.lastUsedAt, { sec: false })}</div>${right}${confirmBox(`passkey:${p.id}`)}${confirmBox(`restore:${p.id}`)}</div>`;
  }).join("");
  const same = a.sameProvider ? `<p class="avert">Vos deux passkeys sont dans le même trousseau : perdre ce compte vous fermerait les deux. Ajoutez une clé de sécurité, ou une passkey d'un autre gestionnaire.</p>` : "";
  return `<section class="blk"><h2>Passkeys</h2>${pk}${same}<div class="actions" style="margin-top:12px">${go("#/acces/ajout", "Ajouter une passkey", { q: true })}</div></section>`;
}
