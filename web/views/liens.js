// Where a link lands: the address of each action, so that no button drops a member at the top of Accès without
// the action they came for (the author's witness of 2026-11-11: « un utilisateur ne saurait pas quoi faire »).
//   #/acces/<section>          Accès, scrolled to that section, which takes the focus and is shown for a moment
//   #/acces/depot/<key>        one repository: where it stands, its consent, its other gestures (web/views/acces/depot.js)
//   #/acces/depot/<key>/accord the same, the focus on the consent
//   #/declarer/<what>/<key>    confirm the first upload, the team's step, modify (web/views/declarer.js)
// <key> is a repository's id, or its name (owner/name, encoded) where only the name is known: the decision reading
// reads the status lines, which name a repository and do not carry its id.
// A screen that does a task (declare, confirm, modify, add a passkey, export) sends its member back where they
// came from once it is done or cancelled, never to the top of Accès: the origin is noted at each change of address.
import { S } from "./base.js";
import { mots } from "./lexique.js";

/** The sections of Accès an address can name, and the id of each one's element. */
export const SECTIONS_ACCES = { cles: "acces-cles", sessions: "acces-sessions", depots: "acces-depots", instances: "acces-instances", reglages: "acces-reglages", membres: "acces-membres", donnees: "acces-donnees", limites: "acces-limites" };
const enc = (k) => encodeURIComponent(String(k ?? ""));
/** A section of Accès. */
export const versSection = (s) => `#/acces/${s}`;
/** One repository's screen; `quoi` = "accord" puts the focus on its consent. */
export const versDepot = (key, quoi = "") => `#/acces/depot/${enc(key)}${quoi ? `/${quoi}` : ""}`;
/** The confirmation of a repository's first upload (or of its new owner). */
export const versConfirmer = (key) => `#/declarer/confirmer/${enc(key)}`;
/** What the team adds to its repository so that the first upload goes out. */
export const versAttente = (key) => `#/declarer/attente/${enc(key)}`;
/** The modification of a repository. */
export const versModifier = (key) => `#/declarer/modifier/${enc(key)}`;

/** A segment of an address, decoded; one that does not decode is none. */
export function decode(seg) {
  try { return decodeURIComponent(String(seg ?? "")); } catch { return null; }
}
/** The repository an address names, by its id, else by its name (a live one before a removed one). */
export function depotDe(repositories, key) {
  if (!key || !Array.isArray(repositories)) return null;
  const byId = repositories.find((r) => r.id === key);
  if (byId) return byId;
  const k = String(key).toLowerCase();
  const named = repositories.filter((r) => String(r.name).toLowerCase() === k);
  return named.find((r) => r.state !== "removed") ?? named[0] ?? null;
}

/**
 * A repository's first upload, from a status line (GET /api/v0/fleet/status): the most recent upload of a repository
 * still waiting for its confirmation. Kept to confirm (send-pending), or not kept for want of consent, its arrival
 * still to confirm (the service keeps its claims, src/application/ingest.js). None when nothing arrived.
 */
export function premierEnvoi(line) {
  if (!line || line.state !== "pending") return null;
  return (line.activity ?? []).find((e) => e.what === "send-pending" || (e.what === "send-not-accepted" && e.refusal === "content-not-consented")) ?? null;
}
/**
 * The next step of an application declared and not yet in the portfolio, from its status line: what it says and
 * where its button leads. `confirm`: the first upload arrived, to confirm; `owner`: the repository arrives under
 * another owner; `install`: nothing arrived, the team adds the call to its repository; `consent`: confirmed, consent
 * not given; `wait`: confirmed and consented, its next check awaited.
 */
export function prochainPas(line) {
  const repo = line?.repository ?? "";
  if (line?.state === "pending") {
    const first = premierEnvoi(line);
    return first ? { kind: "confirm", href: versConfirmer(repo), at: first.at ?? null } : { kind: "install", href: versAttente(repo), at: null };
  }
  if (line?.lastRefusal === "owner-changed") return { kind: "owner", href: versConfirmer(repo), at: line.lastRefusalAt ?? null };
  if (line && line.consent === false) return { kind: "consent", href: versDepot(repo, "accord"), at: null };
  return { kind: "wait", href: versDepot(repo), at: null };
}
/** Where « give consent » leads from a status line: its repository's consent, else the list of the repositories. */
export const versAccord = (line) => (line?.repository ? versDepot(line.repository, "accord") : versSection("depots"));

// ------------------------------------------------------------- the way back from a task
const TACHE = /^#\/(?:declarer(?:\/|$)|acces\/(?:ajout|export|effacer)$)/;
const AILLEURS = /^#\/(?:entree|lien|panne|reprise)(?:\/|$)/;
/** An address as the hash of a URL writes it; the root is #/. */
export const hashOf = (url) => { const u = String(url ?? ""), i = u.indexOf("#"); const h = i < 0 ? "" : u.slice(i); return h && h !== "#" ? h : "#/"; };
/** Is this address a task (a screen one leaves once its gesture is done)? */
export const estTache = (hash) => TACHE.test(String(hash ?? ""));
/**
 * The origin to keep when the address changes from `from` to `to`: entering a task notes where one came from;
 * moving between tasks (declare, then its waiting screen) keeps it; leaving the tasks forgets it.
 */
export function origineApres(prev, from, to) {
  if (!estTache(to)) return null;
  if (estTache(from)) return prev ?? null;
  return from && !AILLEURS.test(from) ? from : null;
}
/** Where a task sends back: its origin, unless it is none or the bare top of Accès; then `home`, the task's own place. */
export function retour(home, origine = S.origine) {
  return origine && origine !== "#/acces" && origine !== "#/acces/" && !estTache(origine) && !AILLEURS.test(origine) ? origine : home;
}
/** The words of a way back, by where it leads. */
export function retourMot(hash) {
  const B = mots().common.back;
  const p = String(hash ?? "").replace(/^#\/?/, "").split("/");
  if (p[0] === "" || (p[0] === "decision" && !p[1])) return B.portfolio;
  if (p[0] === "decision") return B.application;
  if (p[0] === "acces" && p[1] === "depot") return B.depot;
  if (p[0] === "acces" && p[1] === "cles") return B.passkeys;
  if (p[0] === "acces" && p[1] === "donnees") return B.data;
  if (p[0] === "acces") return B.access;
  if (p[0] === "mission") return B.mission;
  if (p[0] === "envois") return B.uploads;
  if (p[0] === "arrivee") return B.arrival;
  if (["flotte", "vue", "history", "proof", "signatures", "pr", "sources"].includes(p[0])) return B.fleet;
  return B.other;
}
/** The attributes of a section of Accès an address can name: its id, the focus it can take, its name read from its heading. */
export const ancre = (k) => ` id="${SECTIONS_ACCES[k]}" tabindex="-1" aria-labelledby="h-${SECTIONS_ACCES[k]}"`;
/** The id of that section's heading. */
export const titreAncre = (k) => ` id="h-${SECTIONS_ACCES[k]}"`;
