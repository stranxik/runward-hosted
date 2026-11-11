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
import { parts, S, main } from "./base.js";
import { loadingView } from "./marks.js";
import { loadFleet, loadAccess, loadJournal, loadSession } from "./api.js";
import { ROUTES } from "./fleet-views.js";
import { paint } from "./shell.js";
import { mots } from "./lexique.js";
import { ecran, charger, porte, poserMessages, releverPortefeuille, controleArrive } from "./mouvement.js";
import { viewEntree } from "./entree.js";
import { viewLien } from "./lien.js";
import { viewReprise } from "./reprise.js";
import { viewArrivee } from "./arrivee.js";
import { viewDeclarer } from "./declarer.js";
import { viewEnvois } from "./envois.js";
import { viewFleet } from "./fleet.js";
import { viewDecision } from "./decision.js";
import { viewAcces } from "./acces.js";
import { viewPanne } from "./panne.js";
import { viewLegal } from "./legal.js";
import { view404 } from "./introuvable.js";

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
  arrivee: { view: (sub) => viewArrivee(sub), reads: "access", signedIn: true },
  declarer: { view: (sub) => viewDeclarer(sub), reads: "access", signedIn: true },
  envois: { view: () => viewEnvois(), reads: "journal", signedIn: true },
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

// ------------------------------------------------------------- the motion of a change of screen (ADR-0027)
// What was shown last: the address, and the application a reading was open on. The blocks of a screen arrive once,
// when one comes to it by a navigation forward: never on a refresh, a switch of language, a way back, a check that
// arrives, nor between two states of one screen (the sign-in's ceremony changes its state in place).
let shown = null, turn = 0, readAt = 0;
const trail = [];
/**
 * What moves when the address `h` is shown after `shown` (the address shown last), `trail` being the addresses come
 * through: nothing on the same address (a refresh, a re-render), a transition without arrival on a way back (the
 * address before the one shown), a transition and the arrival of the screen's blocks on a navigation forward.
 */
export function motionOf(shown, h, trail) {
  if (shown && shown.h === h) return { transition: false, arrival: false, back: false };
  const back = trail.length > 1 && trail[trail.length - 2] === h;
  return { transition: true, arrival: !back, back };
}
const appOf = (route, sub) => (route === "decision" && sub ? sub : null);

export async function show() {
  const mine = ++turn;
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
  // before the first application is confirmed, the fleet's screens open the arrival; the decision reading opens
  // as soon as the arrival is open (the second passkey, or the choice of one), with its empty state (the mock-up's)
  if (S.session && !S.session.arrivalDone && (screen === DECISION ? !S.session.arrivalOpen : screen?.reads === "fleet")) { location.replace("#/arrivee"); return; }
  // the reads of this screen, once per opening (switching fleet views reuses the index: 0 more reads)
  // the sidebar lists the missions from the index once this page has read it; a screen opened cold
  // (Envois, Accès) does not read the index for its sidebar, so its budget stays its own (architecture §6)
  const reads = screen?.reads ? READS[screen.reads] : null;
  const key = reads ? reads.key(sub) : null;
  let waited = false;
  if (S.session && key && loadedFor !== key) {
    loadedFor = key;
    // loading: nothing for 300 ms (the screen shown stays), then a quiet skeleton, then the screen
    // (the same address read again, a refresh: the screen stays as it is until its new reading is there)
    const wait = shown?.h === h ? { fin: () => false } : charger(() => { if (mine !== turn) return; const was = main.offsetHeight; paint(loadingView("")); main.style.minHeight = `${was}px`; }); // the skeleton keeps the screen's height: the foot does not move
    if (screen.reads === "fleet") readAt = Date.now();
    await reads.load(sub);
    waited = wait.fin();
  }
  if (mine !== turn) return; // a later navigation took over while this one was reading
  const view = resolve() ?? view404(location.hash || "#/");
  // a state of the screen already shown (the sign-in's ceremony): it changes in place, its window keeps its size
  if (shown && !waited && view.state && shown.key === view.key && shown.h !== h && porte(view.state) !== null) {
    document.title = `${view.title ? `${view.title} · ` : ""}${mots().brand}`;
    shown = { ...shown, h };
    poserMessages(0);
    return;
  }
  const m = motionOf(shown, h, trail), same = !m.transition, back = m.back;
  const app = appOf(route, sub) ?? (shown?.app && (route === "" || route === "decision") ? shown.app : null);
  // the same address painted again (a refresh, the screen after a gesture): no transition at all, and what a check
  // changed on the portfolio is shown where it changed
  if (same && !waited) {
    const before = releverPortefeuille();
    paint(view);
    controleArrive(before);
  } else {
    await ecran(() => paint(view), { arrivee: m.arrival, vite: waited, app });
    poserMessages();
  }
  if (!same) { if (back) trail.pop(); else trail.push(h); }
  shown = { h, key: view.key, app: appOf(route, sub) };
}
/** The screen shown, painted again from what it already read (a confirmation that opens, a list that changed). */
export const rerender = () => paint(resolve() ?? view404(location.hash));
/** The same screen in the other language: a fade, each piece keeps its place, no arrival. */
export const relang = () => ecran(() => rerender(), { arrivee: false, vite: true, app: shown?.app });
export const refreshScreen = async () => { loadedFor = null; await loadSession(); await show(); };
/**
 * The portfolio read again when its reader comes back to the tab, a minute at least after its last read: a check
 * that arrived meanwhile shows where it changed (the same two reads as an opening, never a poll).
 */
export async function comeBack() {
  if (!S.session || parts().route !== "" || Date.now() - readAt < 60_000) return;
  loadedFor = null;
  await show();
}
