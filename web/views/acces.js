// Access: who enters, and who sends. The screen is its sections, in order, one file each in web/views/acces/:
// a lot that brings a section (connections of agents, members, single sign-on, the closing of the account)
// adds its file there and one line to SECTIONS; the sub-screens (#/acces/<sub>) are named below the same way.
// An address may name a section (#/acces/<section>, web/views/liens.js#SECTIONS_ACCES): the same screen, opened on it.
import { S, esc } from "./base.js";
import { head, mk, reqNote, act, loadingView } from "./marks.js";
import { mots, titreFlotte } from "./lexique.js";
import { sectionPasskeys } from "./acces/passkeys.js";
import { sectionSessions } from "./acces/sessions.js";
import { sectionDepots, sectionInstances, viewInstance } from "./acces/depots.js";
import { sectionReglages } from "./acces/reglages.js";
import { sectionMembres } from "./acces/membres.js";
import { sectionDonnees } from "./acces/donnees.js";
import { sectionLimites } from "./acces/limites.js";
import { viewAjout } from "./acces/ajout.js";
import { viewExport } from "./acces/export.js";
import { viewEffacer } from "./acces/effacer.js";
import { viewDepot } from "./acces/depot.js";
import { SECTIONS_ACCES, versSection, decode } from "./liens.js";

/** The sections of the screen, in the order they are shown; each takes the access view and gives its HTML. */
const SECTIONS = [sectionPasskeys, sectionSessions, sectionDepots, sectionInstances, sectionReglages, sectionMembres, sectionDonnees, sectionLimites];
/** The page's index, in the same order: the section an address names, and its title. */
const INDEX = [["cles", (A) => A.passkeys.h2], ["sessions", (A) => A.sessions.h2], ["depots", (A) => A.depots.h2], ["instances", () => mots().forge.instances.h2], ["reglages", (A) => A.reglages.h2], ["membres", (A) => A.membres.h2], ["donnees", (A) => A.donnees.h2], ["limites", (A) => A.limites.h2]];

export function viewAcces(sub) {
  if (sub === "export") return viewExport();
  if (sub === "effacer") return viewEffacer();
  if (sub === "ajout") return viewAjout();
  // a GitLab instance registered (#/acces/instance), or a key added to one (#/acces/instance/<id>): ADR-0029 section 4
  if (sub === "instance" || sub.startsWith("instance/")) return viewInstance(sub.slice(9));
  const [first, key, quoi, ...rest] = sub.split("/");
  const section = sub && Object.hasOwn(SECTIONS_ACCES, sub) ? sub : null;
  if (sub && !section && !(first === "depot" && key && !rest.length)) return null;
  const W = mots(), A = W.acces, C = W.common;
  const a = S.access;
  if (S.accessError) return { title: A.title, key: "acces", signed: "in", html: `${head(A.head, "")}<h1 class="v">${mk("inv", C.notShown)} ${A.h1Error}</h1><p class="face">${C.serviceSilent}${reqNote(S.accessError)}</p><div class="actions">${act("reload-screen", C.retry)}</div>` };
  if (!a) return loadingView(A.title);
  if (first === "depot") { const k = decode(key); return k ? viewDepot(k, quoi ?? "") : null; }
  // the page's own index: each section by its title, each link opening the screen on it
  const index = `<nav class="sur-page" aria-label="${esc(A.onPage)}"><span class="k">${A.onPage}</span>${INDEX.map(([k, h]) => `<a href="${versSection(k)}">${h(A)}</a>`).join("")}</nav>`;
  const cible = section ? `#${SECTIONS_ACCES[section]}` : null;
  return { title: A.title, key: "acces", signed: "in", focus: cible, cible, html: `${head(A.headTenant(esc(titreFlotte(S.session.tenant.title))), A.headR)}
    <h1 class="v">${A.h1}</h1>
    <p class="face lede">${A.lede}</p>
    ${index}
    <div class="reglages">${SECTIONS.map((s) => s(a)).join("\n    ")}</div>` };
}
