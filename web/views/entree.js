// Entry (signed out): the sign-in and its states, as a page of the public site (ADR-0025). The sign-in itself speaks
// to the one who decides (ADR-0034): the display title says what the app is for, the gesture stands under it, and on
// the right a glass window shows a real example, the public demo's two checks drawn as « La piste » draws an
// application (the six steps, the line as far as the check lets the version go, the step that refuses marked; « Rien ne
// bloque », the steps passed and the line to the end in the passing green, web/app.css, ADR-0038). The
// example is the public demo repository's, written here as its two checks said it (run 15 refused, run 16 after the
// repair), never a tenant's data. The secondary states (unknown passkey, expired request, a browser without
// passkeys, no account, signed out, session closed or ended) keep their window with its relevé « par passkey ». The
// whole haze drifts on this screen only. This origin has no public home: the public site is runward.dev (ADR-0028);
// the signed-out root (/, #/) opens this screen, as #/entree does.
import { S, esc } from "./base.js";
import { act, pkPlain, mk, go, fenetre } from "./marks.js";
import { mots } from "./lexique.js";

/** The states of the sign-in: [the page's title, the display title, the sentence under it, the window's body]. */
function states() {
  const W = mots(), E = W.entree, C = W.common;
  const signin = (a = C.signInPasskey, b = E.onPhone) => `<div class="actions">${act("signin", a, { k: "device" })}${act("signin", b, { q: true, k: "phone" })}</div>`;
  const intent = S.intent ? `<p class="intent" role="note">${E.intent(`<code>${esc(S.intent)}</code>`)}</p>` : "";
  return {
    connexion: [E.connexion.title, E.connexion.h1, E.connexion.face, `${intent}${signin()}${pkPlain()}<p class="note">${E.connexion.note}</p>`],
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

// ------------------------------------------------------------- the example: the public demo, its two checks
// Each step of the demo as its check said it: `ok` its pieces proven, `vide` nothing required there, `refus` a proof
// the check refuses. Run 15 (commit 97fce96): an agent renamed a function, two proofs still cite the old name, at
// Plancher and at Gouverner; run 16 (commit 0b56196), the two lines corrected.
const ETAPES = ["frame", "architect", "floor", "iterate", "govern", "handover"];
const DEMO = [
  { k: "refused", commit: "97fce96", steps: ["ok", "ok", "refus", "vide", "refus", "ok"] },
  { k: "clean", commit: "0b56196", steps: ["ok", "ok", "ok", "vide", "ok", "ok"] },
];
/** One check of the demo as a line of six steps: solid as far as the first refusal (to the end when none), dotted after. */
function piste(ex) {
  const W = mots(), X = W.entree.exemple;
  const stop = ex.steps.indexOf("refus");
  const li = ETAPES.map((id, i) => `<li class="ex-st" data-s="${ex.steps[i]}"${stop >= 0 && i > stop ? " data-apres" : ""}><span class="ex-pt"><span class="ex-mk"></span></span><span class="ex-nom"><span class="ex-n num" aria-hidden="true">${i + 1}</span><span class="ex-l">${esc(W.phase[id])}</span><span class="vh"> : ${esc(X.state[ex.steps[i]])}</span></span></li>`).join("");
  return `<ol class="ex-piste"${stop >= 0 ? ` data-arret="${stop + 1}"` : ""} aria-label="${esc(X.label)}"><li class="ex-ligne" aria-hidden="true"><span class="ex-rempli"></span></li>${li}</ol>`;
}
function exemple() {
  const X = mots().entree.exemple;
  const one = (ex) => `<div class="ex">
      <p class="ex-t"><span class="ex-etat" data-s="${ex.k}"><span class="ex-mk" aria-hidden="true"></span>${esc(X[ex.k].state)}</span><span class="soft small">${esc(X.commit)} <code translate="no">${ex.commit}</code></span></p>
      ${piste(ex)}<p class="ex-p">${esc(X[ex.k].p)}</p></div>`;
  return fenetre(esc(X.bar), `<p class="ex-qui small soft">${X.who}</p>${DEMO.map(one).join("")}`, { cls: "ex-fen" });
}

export function viewEntree(sub) {
  const E = mots().entree, k = sub || "connexion";
  const V = Object.assign(Object.create(null), states());
  const v = V[sub || "connexion"];
  if (!v) return null;
  const [title, h1, face, body] = v;
  // the sign-in: the gesture under the title, the example on the right
  if (k === "connexion") return { title, key: "entree", signed: "out", scene: "pleine", main: "hero-g entree-d", html: `<div class="hero-t" data-porte="${esc(k)}"><p class="amorce">${E.head}</p><h1 class="t-hero">${h1}</h1><p class="sous">${face}</p><div class="porte" data-porte="${esc(k)}">${body}</div></div>
    <div class="hero-e">${NUE}${exemple()}</div>` };
  return { title, key: "entree", signed: "out", scene: "pleine", main: "hero-g", html: `<div class="hero-t" data-porte="${esc(k)}"><p class="amorce">${E.head}</p><h1 class="t-hero">${h1}</h1><p class="sous">${face}</p></div>
    <div class="hero-e">${NUE}${fenetre(E.headR, `<div class="porte" data-porte="${esc(k)}">${body}</div>`, { tag: "div", h: "p", cls: "c-bar" })}</div>` };
}
