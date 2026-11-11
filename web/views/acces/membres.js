// Access, section: the members.
import { ancre, titreAncre } from "../liens.js";
import { mots } from "../lexique.js";

/** The members of the fleet. */
export function sectionMembres(a) {
  const M = mots().acces.membres;
  return `<section class="blk"${ancre("membres")}><h2${titreAncre("membres")}>${M.h2}</h2>
      <div class="arow"><div><div class="nm">${M.you}</div><span class="k">${M.owner}</span></div><div class="small soft">${M.lastOwner}</div><div class="small soft">${M.invite}</div></div></section>`;
}
