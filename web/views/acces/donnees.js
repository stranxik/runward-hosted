// Access, section: leaving with one's data.
import { go } from "../marks.js";
import { mots } from "../lexique.js";

/** The archive, and the erasure of the account. */
export function sectionDonnees(a) {
  const D = mots().acces.donnees;
  return `<section class="blk"><h2>${D.h2}</h2>
      <div class="panel"><p>${D.text}</p>
        <div class="actions" style="margin:0">${go("#/acces/export", D.prepare)}${go("#/acces/effacer", D.erase, { q: true })}</div></div></section>`;
}
