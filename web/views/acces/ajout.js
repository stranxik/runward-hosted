// Access, sub-screen: add a passkey.
import { S } from "../base.js";
import { mk, head, act, pkPlain, go } from "../marks.js";
import { mots } from "../lexique.js";
import { retour, retourMot, versSection } from "../liens.js";

/** Back where the member came from, else to the passkeys in Accès. */
const back = () => { const to = retour(versSection("cles")); return go(to, retourMot(to), { q: true }); };

export function viewAjout() {
  const W = mots(), A = W.acces.ajout, C = W.common;
  const err = S.addError ? `<p class="erreur" role="alert">${S.addError === "exists" ? `${mk("inv", C.alreadyThere)} ${A.exists}` : `${mk("void", C.nothingAdded)} ${A.cancelled}`}</p>` : "";
  return { title: A.title, key: "acces", signed: "in", html: `${head(A.head, C.gestureCheck)}
    <h1 class="v">${A.h1}</h1>
    <p class="face lede">${A.lede}</p>${err}
    <div class="actions">${act("addpk", C.onQr, { k: "phone" })}${act("addpk", A.key, { q: true, k: "key" })}${act("addpk", A.here, { q: true, k: "device" })}</div>
    ${pkPlain()}<div class="actions">${back()}</div>` };
}
