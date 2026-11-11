// Entry (signed out): the sign-in and its states. Kept plain on purpose: its layout is being redesigned by
// the author (2026-11-06); its routes, data and states are complete. The public home is no longer a screen of
// the shell: it is the public site at / (web/site/, ADR-0022), and #/entree alone opens the sign-in.
import { S, esc } from "./base.js";
import { act, forge, pkPlain, mk, go, head } from "./marks.js";
import { mots } from "./lexique.js";

export function viewEntree(sub) {
  const W = mots(), E = W.entree, C = W.common;
  const intent = S.intent && sub === "connexion" ? `<p class="intent" role="note">${E.intent(`<code>${esc(S.intent)}</code>`)}</p>` : "";
  const signin = `<div class="actions">${act("signin", C.signInPasskey, { k: "device" })}${act("signin", E.onPhone, { q: true, k: "phone" })}</div>`;
  const V = {
    connexion: [E.connexion.title, `<h1 class="v">${E.connexion.h1}</h1>
      <p class="face">${E.connexion.face}</p>
      ${intent}${signin}${forge()}${pkPlain()}
      <p class="note">${E.connexion.note}</p>`],
    attente: [E.attente.title, `<h1 class="v">${C.confirmOnDevice}</h1>
      <p class="face">${E.attente.face}</p>
      <div class="charge" role="progressbar" aria-label="${esc(C.waitingPasskey)}"></div><p class="note">${E.attente.note}</p>`],
    echec: [E.echec.title, `<h1 class="v">${E.echec.h1}</h1>
      <p class="face">${mk("inv", E.echec.mk)} ${E.echec.face}</p>
      <div class="actions">${act("signin", E.echec.retry, { k: "device" })}${act("signin", E.usePhone, { q: true, k: "phone" })}</div>
      <p class="note">${E.echec.note}</p>`],
    inconnue: [E.inconnue.title, `<h1 class="v">${E.inconnue.h1}</h1>
      <p class="face">${mk("inv", E.inconnue.mk)} ${E.inconnue.face}</p>
      <div class="actions">${act("signin", E.inconnue.other, { k: "device" })}${act("signin", E.usePhone, { q: true, k: "phone" })}</div>
      <p class="note">${E.inconnue.note}</p>`],
    expiree: [E.expiree.title, `<h1 class="v">${E.expiree.h1}</h1><p class="face">${mk("void", E.expiree.mk)} ${E.expiree.face}</p><div class="actions">${go("#/entree/connexion", E.expiree.again)}</div>`],
    "sans-passkey": [E.sansPasskey.title, `<h1 class="v">${E.sansPasskey.h1}</h1>
      <p class="face">${E.sansPasskey.face}</p>
      <p class="note">${E.sansPasskey.note}</p>`],
    "sans-compte": [E.sansCompte.title, `<h1 class="v">${E.sansCompte.h1}</h1>
      <p class="face">${E.sansCompte.face}</p>
      <p>${E.sansCompte.own}</p>
      <div class="actions">${go("#/entree/connexion", E.sansCompte.back, { q: true })}</div>`],
    sortie: [E.sortie.title, `<h1 class="v">${E.sortie.h1}</h1>
      <p class="face">${mk("void", E.sortie.mk)} ${E.sortie.face}</p>
      <div class="actions">${go("#/entree/connexion", E.sortie.again)}</div>`],
    "session-fermee": [E.fermee.title, `<h1 class="v">${E.fermee.h1}</h1>
      <p class="face">${mk("void", E.fermee.mk)} ${E.fermee.face}</p>${signin}`],
    fin: [E.fin.title, `<h1 class="v">${E.fin.h1}</h1>
      <p class="face">${E.fin.face}</p>${signin}`],
  };
  const v = V[sub || "connexion"];
  if (!v) return null;
  return { title: v[0], key: "entree", signed: "out", html: `${head(E.head, E.headR)}<section>${v[1]}</section>` };
}
