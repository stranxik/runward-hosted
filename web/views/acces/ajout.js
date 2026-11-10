// Access, sub-screen: add a passkey.
import { S } from "../base.js";
import { mk, head, act, PK_PLAIN, go } from "../marks.js";

export function viewAjout() {
  const err = S.addError ? `<p class="erreur" role="alert">${S.addError === "exists" ? `${mk("inv", "déjà là")} Cet appareil porte déjà une passkey de votre compte.` : `${mk("void", "rien d'ajouté")} La création a été annulée sur l'appareil, ou n'a pas été vérifiée. Rien n'a changé.`}</p>` : "";
  return { title: "Ajouter une passkey", key: "acces", signed: "in", html: `${head("accès · ajouter une passkey", "vérification par geste")}
    <h1 class="v">Ajoutez une passkey.</h1>
    <p class="face lede">Choisissez de préférence un autre trousseau que celui de vos passkeys actuelles, ou une clé de sécurité. Votre passkey actuelle vous est d'abord demandée pour ce geste.</p>${err}
    <div class="actions">${act("addpk", "Sur mon téléphone, par code QR", { k: "phone" })}${act("addpk", "Une clé de sécurité", { q: true, k: "key" })}${act("addpk", "Sur cet appareil", { q: true, k: "device" })}</div>
    ${PK_PLAIN}<div class="actions">${go("#/acces", "Revenir à Accès", { q: true })}</div>` };
}
