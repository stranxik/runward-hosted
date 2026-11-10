// The router: which screen an address opens, what that screen reads at its opening, and who may open it.
import { parts, S } from "./base.js";
import { loadingView } from "./marks.js";
import { loadSession, loadFleet, loadAccess, loadJournal } from "./api.js";
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

const PROTECTED = new Set(["arrivee", "declarer", "envois", "acces", "vue", ...ROUTES]);
function resolve() {
  const { route, sub } = parts();
  if (route === "entree") return viewEntree(sub);
  if (route === "lien") return viewLien(sub);
  if (route === "reprise") return sub ? null : viewReprise();
  if (route === "arrivee") return viewArrivee(sub);
  if (route === "declarer") return viewDeclarer(sub);
  if (route === "envois") return viewEnvois();
  if (route === "acces") return viewAcces(sub);
  if (route === "panne") return viewPanne(sub);
  if (route === "legal") return sub ? null : viewLegal();
  if (route === "" || route === "vue" || ROUTES.includes(route)) return viewFleet(route, sub ? decodeURIComponent(sub) : "");
  return null;
}

let loadedFor = null;
/** The next opening reads again (after a gesture that changed what the screen shows). */
export const forgetReads = () => { loadedFor = null; };
export async function show() {
  const { h, route, sub } = parts();
  if (S.session === undefined && !S.error) await loadSession();
  if (S.session === undefined && S.error) { if (route !== "panne") { location.replace(navigator.onLine === false ? "#/panne/hors-ligne" : "#/panne"); return; } }
  if (S.session && route === "entree" && sub !== "sortie") { location.replace(S.session.arrivalDone ? "#/" : "#/arrivee"); return; }
  // signed out: the root opens the public home; any other protected address opens the sign-in, with its intent
  if (!S.session && PROTECTED.has(route)) {
    S.intent = route === "" ? null : location.hash;
    location.replace(S.session === null && S.closedBy === "passkey" ? "#/entree/session-fermee" : route === "" ? "#/entree" : "#/entree/connexion");
    return;
  }
  if (S.session && !S.session.arrivalDone && (route === "" || route === "vue" || ROUTES.includes(route))) { location.replace("#/arrivee"); return; }
  // the reads of this screen, once per opening (switching fleet views reuses the index: 0 more reads)
  // the sidebar lists the missions from the index once this page has read it; a screen opened cold
  // (Envois, Accès) does not read the index for its sidebar, so its budget stays its own (architecture §6)
  const key = route === "" || route === "vue" || ROUTES.includes(route) ? "fleet" : ["arrivee", "declarer", "acces"].includes(route) ? "access" : route === "envois" ? `journal:${sub}` : null;
  if (S.session && key && loadedFor !== key) {
    loadedFor = key;
    paint(loadingView(""));
    if (key === "fleet") await loadFleet(); else if (key === "access") await loadAccess(); else await loadJournal(sub);
  }
  paint(resolve() ?? view404(location.hash || "#/"));
}
export const rerender = () => paint(resolve() ?? view404(location.hash));
export const refreshScreen = async () => { loadedFor = null; await loadSession(); await show(); };
