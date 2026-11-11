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
import { loadFleet, loadAccess, loadJournal, loadSession } from "./api.js";
import { ROUTES } from "./fleet-views.js";
import { paint } from "./shell.js";
import { viewEntree } from "./entree.js";
import { viewLien } from "./lien.js";
import { viewReprise } from "./reprise.js";
import { viewArrivee } from "./arrivee.js";
import { viewDeclarer } from "./declarer.js";
import { viewEnvois } from "./envois.js";
import { viewFleet } from "./fleet.js";
import { viewAcces } from "./acces.js";
import { viewPanne } from "./panne.js";
import { viewLegal } from "./legal.js";
import { view404 } from "./introuvable.js";

// The views of runward-fleet this app shows. The decision reading (`decision`, runward's ADR-0125) came with
// the pin of ADR-0021 and is not a screen of this app yet: its route answers like any unknown one.
const FLEET_ROUTES = ROUTES.filter((r) => r !== "decision");
/** The fleet's screens: the dashboard, a mission, and the views of the pinned runward-fleet this app shows. */
const FLEET = { view: (sub, route) => viewFleet(route, sub ? decodeURIComponent(sub) : ""), reads: "fleet", signedIn: true };
/** The screens, by route: its view (given the rest of the address), what it reads, whether it asks a session. */
const SCREENS = {
  entree: { view: (sub) => viewEntree(sub) },
  lien: { view: (sub) => viewLien(sub) },
  reprise: { view: (sub) => (sub ? null : viewReprise()) },
  arrivee: { view: (sub) => viewArrivee(sub), reads: "access", signedIn: true },
  declarer: { view: (sub) => viewDeclarer(sub), reads: "access", signedIn: true },
  envois: { view: () => viewEnvois(), reads: "journal", signedIn: true },
  acces: { view: (sub) => viewAcces(sub), reads: "access", signedIn: true },
  panne: { view: (sub) => viewPanne(sub) },
  legal: { view: (sub) => (sub ? null : viewLegal()) },
};
const isFleet = (route) => route === "" || route === "vue" || FLEET_ROUTES.includes(route);
const screenOf = (route) => (Object.hasOwn(SCREENS, route) ? SCREENS[route] : isFleet(route) ? FLEET : null);

/** The reads of a screen at its opening: `key` names the opening (the same key is not read twice), `load` reads. */
const READS = {
  fleet: { key: () => "fleet", load: () => loadFleet() },
  access: { key: () => "access", load: () => loadAccess() },
  journal: { key: (sub) => `journal:${sub}`, load: (sub) => loadJournal(sub) },
};

function resolve() {
  const { route, sub } = parts();
  const screen = screenOf(route);
  return screen ? screen.view(sub, route) : null;
}

let loadedFor = null;
/** The next opening reads again (after a gesture that changed what the screen shows). */
export const forgetReads = () => { loadedFor = null; };
export async function show() {
  const { h, route, sub } = parts();
  const screen = screenOf(route);
  if (S.session === undefined && !S.error) await loadSession();
  if (S.session === undefined && S.error) { if (route !== "panne") { location.replace(navigator.onLine === false ? "#/panne/hors-ligne" : "#/panne"); return; } }
  if (S.session && route === "entree" && sub !== "sortie") { location.replace(S.session.arrivalDone ? "#/" : "#/arrivee"); return; }
  // signed out: the root opens the public site at / (web/site/, ADR-0022); any other protected address opens the
  // sign-in, with its intent
  if (!S.session && screen?.signedIn) {
    S.intent = route === "" ? null : location.hash;
    if (S.session === null && S.closedBy === "passkey") location.replace("#/entree/session-fermee");
    else if (route === "") location.replace("/");
    else location.replace("#/entree/connexion");
    return;
  }
  if (S.session && !S.session.arrivalDone && isFleet(route)) { location.replace("#/arrivee"); return; }
  // the reads of this screen, once per opening (switching fleet views reuses the index: 0 more reads)
  // the sidebar lists the missions from the index once this page has read it; a screen opened cold
  // (Envois, Accès) does not read the index for its sidebar, so its budget stays its own (architecture §6)
  const reads = screen?.reads ? READS[screen.reads] : null;
  const key = reads ? reads.key(sub) : null;
  if (S.session && key && loadedFor !== key) {
    loadedFor = key;
    paint(loadingView(""));
    await reads.load(sub);
  }
  paint(resolve() ?? view404(location.hash || "#/"));
}
export const rerender = () => paint(resolve() ?? view404(location.hash));
export const refreshScreen = async () => { loadedFor = null; await loadSession(); await show(); };
