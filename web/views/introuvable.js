// An address that leads nowhere.
import { esc, S } from "./base.js";
import { head, mk, go } from "./marks.js";

export function view404(hash) {
  return { title: "Adresse inconnue", key: "panne", signed: "any", html: `${head("runward hébergé", "404")}<h1 class="v">Cette adresse n'existe pas.</h1><p class="face">${mk("void", "introuvable")} <code>${esc(hash)}</code> ne mène à aucune page de ce service. Le lien est peut-être incomplet.</p><div class="actions">${S.session ? go("#/", "Ouvrir la flotte") : go("#/entree/connexion", "Aller à la connexion")}</div>` };
}
