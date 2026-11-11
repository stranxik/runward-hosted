// Access, section: what the service keeps, and its limits, said as they are.
import { esc } from "../base.js";
import { ancre, titreAncre } from "../liens.js";
import { mots } from "../lexique.js";

/** What is kept, and what the service does not protect from. */
export function sectionLimites(a) {
  const L = mots().acces.limites;
  return `<section class="blk"${ancre("limites")}><h2${titreAncre("limites")}>${L.h2}</h2>
      <ul class="small limites">
        <li>${L.kept(esc(a.retention.removedRepositoryDays), esc(a.retention.backupDays))}</li>
        ${L.items.map((i) => `<li>${i}</li>`).join("\n        ")}
      </ul></section>`;
}
