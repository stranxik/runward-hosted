// Legal notice, privacy, security.
import { esc, META } from "./base.js";
import { head } from "./marks.js";

export function viewLegal() {
  return { title: "Mentions et sécurité", key: "panne", signed: "any", html: `${head("runward hébergé · mentions", "écran public, non indexé")}
    <h1 class="v">Mentions, confidentialité, sécurité.</h1>
    <div class="grid2">
      <section class="panel"><h2>Mentions légales</h2><p class="small"><span class="k">éditeur</span>${esc(META("runward-publisher") || "Thibault Souris, personne physique")}</p><p class="small"><span class="k">hébergeur</span>Scaleway, région Paris</p><p class="small"><span class="k">service</span>runward hébergé, sous licence FSL-1.1-MIT ; la vue est runward-fleet, sous licence MIT.</p></section>
      <section class="panel"><h2>Confidentialité</h2><ul class="small"><li>Pour vous connecter : la clé publique de vos passkeys et vos sessions, rien d'autre. Aucune adresse e-mail, aucun mot de passe.</li><li>Pour vos missions : le contenu des exports des dépôts que vous avez consentis, gardé tant que le dépôt est déclaré, puis 30 jours.</li><li>Un seul cookie, celui de la session. Aucune mesure d'audience, aucun service tiers dans la page.</li><li>Tout est hébergé dans l'Union européenne. Effacement dans Accès, ou sur demande.</li></ul></section>
      <section class="panel"><h2>Sécurité</h2><p class="small">Pour signaler une faille : le contact de <a href="/.well-known/security.txt"><code>/.well-known/security.txt</code></a> (RFC 9116).</p></section>
    </div>` };
}
