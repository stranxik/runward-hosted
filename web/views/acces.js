// Access: who enters, and who sends. The screen is its sections, in order, one file each in web/views/acces/:
// a lot that brings a section (connections of agents, members, single sign-on, the closing of the account)
// adds its file there and one line to SECTIONS; the sub-screens (#/acces/<sub>) are named below the same way.
import { S, esc } from "./base.js";
import { head, mk, reqNote, act, loadingView } from "./marks.js";
import { sectionPasskeys } from "./acces/passkeys.js";
import { sectionSessions } from "./acces/sessions.js";
import { sectionDepots } from "./acces/depots.js";
import { sectionReglages } from "./acces/reglages.js";
import { sectionMembres } from "./acces/membres.js";
import { sectionDonnees } from "./acces/donnees.js";
import { sectionLimites } from "./acces/limites.js";
import { viewAjout } from "./acces/ajout.js";
import { viewExport } from "./acces/export.js";
import { viewEffacer } from "./acces/effacer.js";

/** The sections of the screen, in the order they are shown; each takes the access view and gives its HTML. */
const SECTIONS = [sectionPasskeys, sectionSessions, sectionDepots, sectionReglages, sectionMembres, sectionDonnees, sectionLimites];

export function viewAcces(sub) {
  if (sub === "export") return viewExport();
  if (sub === "effacer") return viewEffacer();
  if (sub === "ajout") return viewAjout();
  if (sub) return null;
  const a = S.access;
  if (S.accessError) return { title: "Accès", key: "acces", signed: "in", html: `${head("accès", "")}<h1 class="v">${mk("inv", "non affiché")} Accès ne s'affiche pas.</h1><p class="face">Le service n'a pas répondu.${reqNote(S.accessError)}</p><div class="actions">${act("reload-screen", "Réessayer")}</div>` };
  if (!a) return loadingView("Accès");
  return { title: "Accès", key: "acces", signed: "in", html: `${head(`accès · ${esc(S.session.tenant.title)}`, "toute modification demande une passkey récente, ou une vérification par geste")}
    <h1 class="v">Qui entre, et qui envoie.</h1>
    <p class="face lede">Vos passkeys et vos sessions ouvrent la lecture. Les dépôts déclarés sont les seuls à pouvoir écrire dans votre flotte.</p>
    ${SECTIONS.map((s) => s(a)).join("\n    ")}` };
}
