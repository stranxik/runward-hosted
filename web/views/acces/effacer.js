// Access, sub-screen: erase the account (an operator's gesture in this version).
import { head, go } from "../marks.js";

export function viewEffacer() {
  return { title: "Effacer ce compte", key: "acces", signed: "in", html: `${head("accès · effacer", "geste d'opérateur dans cette version")}
    <h1 class="v">Effacer ce compte.</h1>
    <p class="face lede">Tout le contenu de la flotte est effacé : dépôts, contenu reçu, index, journal, membres et passkeys.</p>
    <ul class="effets"><li>Exportez d'abord l'archive si vous voulez garder la vue.</li><li>L'effacement est fait dans les 30 jours de la demande. Les sauvegardes l'oublient au plus tard 7 jours après.</li><li>Reste seulement, au journal de l'opérateur : l'empreinte du compte, la date et la dernière tête du journal, sans aucun nom.</li></ul>
    <p>Pour l'instant, l'opérateur du service fait ce geste, par un run approuvé du dépôt d'opérateur.</p>
    <div class="actions">${go("#/acces/export", "Exporter d'abord")}${go("#/acces", "Revenir à Accès", { q: true })}</div>` };
}
