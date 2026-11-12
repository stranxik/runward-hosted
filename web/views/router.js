// The router: which screen an address opens, what that screen reads at its opening, and who may open it.
//
// One line per screen in SCREENS. A lot that brings a screen adds its file in web/views/, its line here and
// its line in MODULES (src/http/assets.js); it does not touch another screen's file. Routes kept for the
// screens designed on 2026-11-10 (none is written yet, each answers "unknown address" until its lot lands):
//   parcours      the path through the six steps, per application     web/views/parcours.js      reads: fleet
//   portefeuille  the map of the portfolio, applications by steps     web/views/portefeuille.js  reads: fleet
//   historique    the evolution over time, and the live refresh       web/views/historique.js    reads: its own
//   registre      the register of the ADRs                            web/views/registre.js      reads: its own
//   documents     the reader of the mission's documents               web/views/documents.js     reads: its own
// A screen that needs a new read names it in READS: the key says when the read is made again, the loader makes
// it (web/views/api.js). The budget of architecture §6 holds for every screen: 4 reads at most at its opening.
import { parts, S } from "./base.js";
import { loadingView } from "./marks.js";
import { loadFleet, loadAccess, loadJournal, loadSession, loadFlux, loadStatus } from "./api.js";
import { ROUTES } from "./fleet-views.js";
import { paint } from "./shell.js";
import { viewEntree } from "./entree.js";
import { viewLien } from "./lien.js";
import { viewReprise } from "./reprise.js";
import { viewArrivee } from "./arrivee.js";
import { viewDeclarer } from "./declarer.js";
import { viewEnvois } from "./envois.js";
import { viewFleet, viewVuesFermees } from "./fleet.js";
import { viewDecision } from "./decision.js";
import { viewAcces } from "./acces.js";
import { viewPanne } from "./panne.js";
import { viewLegal } from "./legal.js";
import { view404 } from "./introuvable.js";
import { journalKey } from "./journal-filtres.js";

// The views of runward-fleet this app shows. The decision reading (`decision`, runward's ADR-0125, pinned by
// ADR-0021) is the app's own screen below, the one a signed-in member lands on (#/), with one application's
// reading at #/decision/<id> (web/views/decision.js): the views' own `decision` route is never taken here.
const FLEET_ROUTES = ROUTES.filter((r) => r !== "decision");
/** The fleet's screens: the dashboard (#/flotte), a mission, and the views of the pinned runward-fleet this app shows. */
const FLEET = { view: (sub, route) => viewFleet(route, sub ? decodeURIComponent(sub) : ""), reads: "fleet", signedIn: true };
/** The decision reading: the portfolio at #/ and #/decision, an application at #/decision/<id>. It reads the index. */
const DECISION = { view: (sub) => viewDecision(sub), reads: "fleet", signedIn: true };
/** The screens, by route: its view (given the rest of the address), what it reads, whether it asks a session. */
const SCREENS = {
  "": DECISION,
  decision: DECISION,
  entree: { view: (sub) => viewEntree(sub) },
  lien: { view: (sub) => viewLien(sub) },
  reprise: { view: (sub) => (sub ? null : viewReprise()) },
  // the connect flow and the arrival read again at each entry (`fresh`), and while they are shown (web/views/flux-vif.js):
  // a tab left open since the declaration shows the first check that arrived since, never what it read at its load
  arrivee: { view: (sub) => viewArrivee(sub), reads: "access", signedIn: true, fresh: true },
  declarer: { view: (sub) => viewDeclarer(sub), reads: "flux", signedIn: true, fresh: true },
  envois: { view: (sub, route, query) => viewEnvois(sub, query), reads: "journal", signedIn: true },
  acces: { view: (sub) => viewAcces(sub), reads: "access", signedIn: true },
  panne: { view: (sub) => viewPanne(sub) },
  legal: { view: (sub) => (sub ? null : viewLegal()) },
};
const isFleet = (route) => route === "vue" || route === "flotte" || FLEET_ROUTES.includes(route);
const screenOf = (route) => (Object.hasOwn(SCREENS, route) ? SCREENS[route] : isFleet(route) ? FLEET : null);

/** The reads of a screen at its opening: `key` names the opening (the same key is not read twice), `load` reads. */
const READS = {
  fleet: { key: () => "fleet", load: () => loadFleet() },
  access: { key: () => "access", load: () => loadAccess() },
  // the journal's page and its filters (ADR-0037): the entry shown (`entree`) is not a read, a change of filter is
  journal: { key: (sub, query) => `journal:${sub}?${journalKey(query)}`, load: (sub, query) => Promise.all([loadJournal(sub, query), loadStatus()]) },
  // the connect flow (ADR-0037): the access view (the repositories, their pins), the status lines (a refusal, the
  // first check's arrival) and the index (the first verdict); three reads, within the budget of architecture §6
  flux: { key: () => "flux", load: () => loadFlux() },
};

function resolve() {
  const { route, sub, query } = parts();
  const screen = screenOf(route);
  return screen ? screen.view(sub, route, query) : null;
}

let loadedFor = null;
/** The next opening reads again (after a gesture that changed what the screen shows). */
export const forgetReads = () => { loadedFor = null; };
export async function show() {
  const { route, sub, query } = parts();
  const screen = screenOf(route);
  if (S.session === undefined && !S.error) await loadSession();
  if (S.session === undefined && S.error) { if (route !== "panne") { location.replace(navigator.onLine === false ? "#/panne/hors-ligne" : "#/panne"); return; } }
  if (S.session && route === "entree" && sub !== "sortie") { location.replace(S.session.arrivalDone ? "#/" : "#/arrivee"); return; }
  // signed out: the root opens the sign-in (the public site is at runward.dev, ADR-0028: this origin has no public
  // home); any other protected address opens the sign-in too, with its intent
  if (!S.session && screen?.signedIn) {
    S.intent = route === "" ? null : location.hash;
    if (S.session === null && S.closedBy === "passkey") location.replace("#/entree/session-fermee");
    else if (route === "") location.replace("#/entree");
    else location.replace("#/entree/connexion");
    return;
  }
  // until the arrival is open (the second passkey, or the choice of one), the screens that read the index open the
  // arrival. Once it is open, the decision reading opens with its empty state; the technical views open once the first
  // check of an application is confirmed, and before that their address says so (ADR-0034), never a silent redirect
  if (S.session && !S.session.arrivalOpen && screen?.reads === "fleet") { location.replace("#/arrivee"); return; }
  if (S.session && !S.session.arrivalDone && screen === FLEET) { paint(viewVuesFermees(route)); return; }
  // the reads of this screen, once per opening (switching fleet views reuses the index: 0 more reads)
  // the sidebar lists the missions from the index once this page has read it; a screen opened cold
  // (Envois, Accès) does not read the index for its sidebar, so its budget stays its own (architecture §6)
  const reads = screen?.reads ? READS[screen.reads] : null;
  const key = reads ? reads.key(sub, query) : null;
  if (S.session && key && (loadedFor !== key || screen.fresh)) {
    // a screen read again at its entry (`fresh`) keeps what it shows while it reads: no skeleton between two of its steps
    if (loadedFor !== key) paint(loadingView(""));
    loadedFor = key;
    await reads.load(sub, query);
  }
  paint(resolve() ?? view404(location.hash || "#/"));
}
export const rerender = () => paint(resolve() ?? view404(location.hash));
export const refreshScreen = async () => { loadedFor = null; await loadSession(); await show(); };
