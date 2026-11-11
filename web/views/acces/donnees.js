// Access, section: leaving with one's data.
import { go, fenetre } from "../marks.js";
import { mots } from "../lexique.js";
import { esc } from "../base.js";
import { SECTIONS_ACCES } from "../liens.js";

/** The archive, and the erasure of the account. */
export function sectionDonnees(a) {
  const D = mots().acces.donnees;
  return fenetre(D.h2, `<p>${D.text}</p>
        <div class="actions">${go("#/acces/export", D.prepare)}${go("#/acces/effacer", D.erase, { q: true })}</div>`, { cls: "donnees", attrs: ` id="${SECTIONS_ACCES.donnees}" tabindex="-1" aria-label="${esc(D.h2)}"` });
}
