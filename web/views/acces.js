// Compte (ADR-0037 point 3): its sections as a list, the one chosen in the detail pane, in the panes of the fixed shell
// (web/views/volets.js). The sections, one file each in web/views/acces/, and their gestures are those of before: the
// same confirmation boxes, the same verification at each gesture, the same routes. An address names a section
// (#/acces/<section>, web/views/liens.js#SECTIONS_ACCES), a repository (#/acces/depot/<key>[/accord]) or a task
// (#/acces/ajout, export, effacer, instance): the task opens in the detail pane, beside the list, its section marked.
// A lot that brings a section adds its file in web/views/acces/ and one line to SECTIONS.
import { S, esc } from "./base.js";
import { mk, reqNote, act } from "./marks.js";
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
import { fenetre, barre, rangee, liste, tete, entete, corps, etat, squelette, VOLET_FOCUS } from "./volets.js";

/**
 * The sections, in the order of the list: the address's word, its title, its HTML (from the access view), and the one
 * line its row says (what it holds now).
 */
export const SECTIONS = [
  ["cles", (A) => A.passkeys.h2, sectionPasskeys, (a, Z) => Z.cles((a.passkeys ?? []).filter((p) => !p.removedAt).length)],
  ["sessions", (A) => A.sessions.h2, sectionSessions, (a, Z) => Z.sessions((a.sessions ?? []).length)],
  ["depots", (A) => A.depots.h2, sectionDepots, (a, Z) => { const live = (a.repositories ?? []).filter((r) => r.state !== "removed"); return Z.depots(live.length, live.filter((r) => r.state === "pinned").length, live.filter((r) => r.state === "pending").length); }],
  ["instances", () => mots().forge.instances.h2, sectionInstances, (a, Z) => Z.instances((a.issuers ?? []).length)],
  ["reglages", (A) => A.reglages.h2, sectionReglages, (a, Z, A) => Z.reglages(a.lang === "en" ? A.reglages.en : A.reglages.fr, a.reader)],
  ["membres", (A) => A.membres.h2, sectionMembres, (a, Z) => Z.membres],
  ["donnees", (A) => A.donnees.h2, sectionDonnees, (a, Z) => Z.donnees],
  ["limites", (A) => A.limites.h2, sectionLimites, (a, Z) => Z.limites],
];
/** The section a task belongs to: the list marks it while the task is open beside it. */
const DE_LA_TACHE = { ajout: "cles", export: "donnees", effacer: "donnees", instance: "instances", depot: "depots" };

/** The window of Compte: the list of its sections, and `detail` (HTML) beside it. */
function fenetreCompte(a, courante, { detail, choisie = null }) {
  const W = mots(), A = W.acces, Z = W.parcours.compte.sum;
  const rows = SECTIONS.map(([k, titre, , resume]) => rangee({ href: versSection(k), cle: `c:${k}`, courant: courante === k, choisie: choisie === k, cls: "crow", html: `<b>${esc(titre(A))}</b><span>${esc(resume(a, Z, A))}</span>` })).join("");
  const bar = barre({ titre: `${esc(A.title)} <span class="mono">· ${esc(titreFlotte(S.session.tenant.title))}</span>`, direct: `<p class="direct perime">${esc(A.headR)}</p>` });
  return fenetre({ bar, liste: `${tete(esc(A.title))}${liste(rows, W.parcours.compte.list)}`, detail, label: W.parcours.compte.list });
}
/** A task of Compte (a passkey to add, the export, the erasure, an instance, a repository), opened beside the list. */
function tache(a, k, v) {
  if (!v) return null;
  return { ...v, main: "volets", ecran: "detail", cle: "acces", sel: `${k}:${v.title}`, focus: v.focus ?? VOLET_FOCUS, cible: v.cible ?? null, html: fenetreCompte(a, k, { detail: `<div class="d-body compte-tache">${v.html}</div>` }) };
}

export function viewAcces(sub) {
  const W = mots(), A = W.acces, C = W.common;
  const a = S.access;
  const [first, key, quoi, ...rest] = sub.split("/");
  const section = sub && Object.hasOwn(SECTIONS_ACCES, sub) ? sub : null;
  const task = ["export", "effacer", "ajout"].includes(sub) || sub === "instance" || sub.startsWith("instance/") || (first === "depot" && key && !rest.length);
  if (sub && !section && !task) return null;
  const base = { title: A.title, key: "acces", signed: "in", main: "volets", cle: "acces" };
  if (S.accessError) return { ...base, ecran: "detail", html: fenetre({ bar: barre({ titre: esc(A.title) }), seul: etat({ h1: true, marque: mk("inv", C.notShown), titre: A.h1Error, texte: `${C.serviceSilent}${reqNote(S.accessError)}`, actions: act("reload-screen", C.retry) }) }) };
  if (!a) return { ...base, ecran: "liste", html: squelette(8, W.marks.loading) };
  if (sub === "export") return tache(a, "donnees", viewExport());
  if (sub === "effacer") return tache(a, "donnees", viewEffacer());
  if (sub === "ajout") return tache(a, "cles", viewAjout());
  // a GitLab instance registered (#/acces/instance), or a key added to one (#/acces/instance/<id>): ADR-0029 section 4
  if (sub === "instance" || sub.startsWith("instance/")) return tache(a, DE_LA_TACHE.instance, viewInstance(sub.slice(9)));
  if (first === "depot") { const k = decode(key); return k ? tache(a, DE_LA_TACHE.depot, viewDepot(k, quoi ?? "")) : null; }
  // a section: the one the address names; on a desk the first when none is named (drawn as current, not said so)
  const k = section ?? SECTIONS[0][0];
  const [, titre, html, resume] = SECTIONS.find(([x]) => x === k);
  const detail = `${entete({ meta: `<span class="soft">${esc(A.title)}</span>`, titre: esc(titre(A)), phrase: esc(resume(a, W.parcours.compte.sum, A)) })}${corps(`<div class="compte-sec">${html(a)}</div>`)}`;
  return {
    ...base, ecran: section ? "detail" : "liste", sel: k, title: section ? titre(A) : A.title,
    crumb: section ? [[A.title, "#/acces"], [titre(A)]] : null,
    focus: section ? `#${SECTIONS_ACCES[section]}` : VOLET_FOCUS, cible: null,
    html: fenetreCompte(a, section, { detail, choisie: section ? null : k }),
  };
}
