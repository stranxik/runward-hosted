// Access, sub-screen: erase the account (an operator's gesture in this version).
import { head, go } from "../marks.js";
import { mots } from "../lexique.js";
import { retour, retourMot, versSection } from "../liens.js";

/** Back where the member came from, else to « Partir avec vos données » in Accès. */
const back = () => { const to = retour(versSection("donnees")); return go(to, retourMot(to), { q: true }); };

export function viewEffacer() {
  const W = mots(), E = W.acces.effacer;
  return { title: E.title, key: "acces", signed: "in", html: `${head(E.head, E.headR)}
    <h1 class="v">${E.h1}</h1>
    <p class="face lede">${E.lede}</p>
    <ul class="effets">${E.effects.map((e) => `<li>${e}</li>`).join("")}</ul>
    <p>${E.operator}</p>
    <div class="actions">${go("#/acces/export", E.exportFirst)}${back()}</div>` };
}
