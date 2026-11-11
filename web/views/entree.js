// Entry (signed out): the sign-in and its states, as a page of the public site (ADR-0025): the display title on the
// left, and on the right a glass window whose bar is the relevé « par passkey », standing on the whole haze, the one
// screen where it drifts. The secondary states (unknown passkey, expired request, a browser without passkeys, no
// account, signed out, session closed or ended) take the same layout. The public home is the site at / (web/site/,
// ADR-0022); #/entree alone opens the sign-in.
import { S, esc } from "./base.js";
import { act, forge, pkPlain, mk, go, fenetre, souffle, coche } from "./marks.js";
import { mots } from "./lexique.js";

/** The states of the sign-in: [the page's title, the display title, the sentence under it, the window's body]. */
function states() {
  const W = mots(), E = W.entree, C = W.common;
  const signin = (a = C.signInPasskey, b = E.onPhone) => `<div class="actions">${act("signin", a, { k: "device" })}${act("signin", b, { q: true, k: "phone" })}</div>`;
  const intent = S.intent ? `<p class="intent" role="note">${E.intent(`<code>${esc(S.intent)}</code>`)}</p>` : "";
  return {
    connexion: [E.connexion.title, E.connexion.h1, E.connexion.face, `${intent}${signin()}${forge()}${pkPlain()}<p class="note">${E.connexion.note}</p>`],
    attente: [E.attente.title, C.confirmOnDevice, E.attente.face, `${souffle(C.waitingPasskey)}<p class="note">${E.attente.note}</p>`],
    echec: [E.echec.title, E.echec.h1, `${mk("inv", E.echec.mk)} ${E.echec.face}`, `${signin(E.echec.retry, E.usePhone)}<p class="note">${E.echec.note}</p>`],
    inconnue: [E.inconnue.title, E.inconnue.h1, `${mk("inv", E.inconnue.mk)} ${E.inconnue.face}`, `${signin(E.inconnue.other, E.usePhone)}<p class="note">${E.inconnue.note}</p>`],
    expiree: [E.expiree.title, E.expiree.h1, `${mk("void", E.expiree.mk)} ${E.expiree.face}`, `<div class="actions">${go("#/entree/connexion", E.expiree.again)}</div>`],
    "sans-passkey": [E.sansPasskey.title, E.sansPasskey.h1, E.sansPasskey.face, `<p class="note">${E.sansPasskey.note}</p>`],
    "sans-compte": [E.sansCompte.title, E.sansCompte.h1, E.sansCompte.face, `<p>${E.sansCompte.own}</p><div class="actions">${go("#/entree/connexion", E.sansCompte.back, { q: true })}</div>`],
    sortie: [E.sortie.title, E.sortie.h1, `${mk("void", E.sortie.mk)} ${E.sortie.face}`, `<div class="actions">${go("#/entree/connexion", E.sortie.again)}</div>`],
    "session-fermee": [E.fermee.title, E.fermee.h1, `${mk("void", E.fermee.mk)} ${E.fermee.face}`, signin()],
    fin: [E.fin.title, E.fin.h1, E.fin.face, signin()],
  };
}
const NUE = `<div class="nue" aria-hidden="true"><i></i><i></i><i></i><i></i></div>`;
/** The states the ceremony passes through without leaving the screen: they are stacked in one cell, one shown. */
const CEREMONIE = ["connexion", "attente", "echec", "inconnue", "expiree"];

export function viewEntree(sub) {
  const W = mots(), E = W.entree, k = sub || "connexion";
  const V = Object.assign(Object.create(null), states());
  const v = V[sub || "connexion"];
  if (!v) return null;
  // the states of the ceremony are all there, the others hidden and inert: the window keeps its size from one to the
  // next, and the text beside it changes in place (web/views/mouvement.js, porte). Any other state stands alone.
  const pile = CEREMONIE.includes(k) ? CEREMONIE : [k];
  const on = (x) => (x === k ? " data-actif" : " inert");
  const gauche = pile.map((x) => `<div data-porte="${esc(x)}"${on(x)}><p class="amorce">${E.head}</p><h1 class="t-hero">${V[x][1]}</h1><p class="sous">${V[x][2]}</p></div>`).join("");
  // the passkey accepted: a check that draws itself; its word is for a reader who does not see it (the screen changes next)
  const succes = pile.length > 1 ? `<div class="porte-etat" data-porte="succes" inert><div class="reussite">${coche(true)}<span class="vh">${esc(W.done.signedIn)}</span></div></div>` : "";
  const droite = pile.map((x) => `<div class="porte-etat" data-porte="${esc(x)}"${on(x)}>${V[x][3]}</div>`).join("") + succes;
  return { title: v[0], key: "entree", signed: "out", scene: "pleine", main: "hero-g", state: k, html: `<div class="hero-t pile">${gauche}</div>
    <div class="hero-e">${NUE}${fenetre(E.headR, `<div class="porte pile">${droite}</div>`, { tag: "div", h: "p", cls: "c-bar" })}</div>` };
}
