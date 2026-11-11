// An address that leads nowhere.
import { esc, S } from "./base.js";
import { head, mk, go } from "./marks.js";
import { mots } from "./lexique.js";

export function view404(hash) {
  const W = mots(), I = W.introuvable, C = W.common;
  return { title: I.title, key: "panne", signed: "any", html: `${head(I.head, "404")}<h1 class="v">${I.h1}</h1><p class="face">${mk("void", I.mk)} ${I.face(`<code>${esc(hash)}</code>`)}</p><div class="actions">${S.session ? go("#/", C.openFleet) : go("#/entree/connexion", C.goSignIn)}</div>` };
}
