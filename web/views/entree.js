// Entry (signed out): the sign-in and its states, as a page of the public site (ADR-0025): the display title on the
// left, and on the right a glass window whose bar is the relevé « par passkey », standing on the whole haze, the one
// screen where it drifts. The secondary states (unknown passkey, expired request, a browser without passkeys, no
// account, signed out, session closed or ended) take the same layout. This origin has no public home: the public site
// is runward.dev (ADR-0028); the signed-out root (/, #/) opens this screen, as #/entree does.
import { S, esc } from "./base.js";
import { act, forge, pkPlain, mk, go, fenetre } from "./marks.js";
import { mots } from "./lexique.js";

/** The states of the sign-in: [the page's title, the display title, the sentence under it, the window's body]. */
function states() {
  const W = mots(), E = W.entree, C = W.common;
  const signin = (a = C.signInPasskey, b = E.onPhone) => `<div class="actions">${act("signin", a, { k: "device" })}${act("signin", b, { q: true, k: "phone" })}</div>`;
  const intent = S.intent ? `<p class="intent" role="note">${E.intent(`<code>${esc(S.intent)}</code>`)}</p>` : "";
  return {
    connexion: [E.connexion.title, E.connexion.h1, E.connexion.face, `${intent}${signin()}${forge()}${pkPlain()}<p class="note">${E.connexion.note}</p>`],
    attente: [E.attente.title, C.confirmOnDevice, E.attente.face, `<div class="charge" role="progressbar" aria-label="${esc(C.waitingPasskey)}"></div><p class="note">${E.attente.note}</p>`],
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

export function viewEntree(sub) {
  const E = mots().entree, k = sub || "connexion";
  const V = Object.assign(Object.create(null), states());
  const v = V[sub || "connexion"];
  if (!v) return null;
  const [title, h1, face, body] = v;
  return { title, key: "entree", signed: "out", scene: "pleine", main: "hero-g", html: `<div class="hero-t" data-porte="${esc(k)}"><p class="amorce">${E.head}</p><h1 class="t-hero">${h1}</h1><p class="sous">${face}</p></div>
    <div class="hero-e">${NUE}${fenetre(E.headR, `<div class="porte" data-porte="${esc(k)}">${body}</div>`, { tag: "div", h: "p", cls: "c-bar" })}</div>` };
}
