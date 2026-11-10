// Access, section: leaving with one's data.
import { go } from "../marks.js";

/** The archive, and the erasure of the account. */
export function sectionDonnees(a) {
  return `<section class="blk"><h2>Partir avec vos données</h2>
      <div class="panel"><p>L'archive contient l'inventaire <code>fleet.json</code> dans toutes ses versions, les fichiers reçus tels quels, le journal et <code>replay.json</code>, qui dit quelle version de runward-fleet redonne chaque index. Rejouée chez vous par <code>runward-fleet build</code>, elle redonne la même vue.</p>
        <div class="actions" style="margin:0">${go("#/acces/export", "Préparer l'archive")}${go("#/acces/effacer", "Effacer ce compte", { q: true })}</div></div></section>`;
}
