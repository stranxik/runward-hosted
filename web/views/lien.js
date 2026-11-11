// Links: bootstrap, recovery, invitation (seven states).
import { S, esc } from "./base.js";
import { when } from "./time.js";
import { head, mk, act, reqNote, go, pkPlain, forge } from "./marks.js";
import { mots, titreFlotte } from "./lexique.js";

export function viewLien(sub) {
  const W = mots(), T = W.lien, C = W.common;
  const info = S.linkInfo;
  const frame = (title, h1, body) => ({ title, key: "lien", signed: "out", html: `${head(T.head, T.headR)}<section class="lien"><h1 class="v">${h1}</h1>${body}</section>` });
  if (!S.link) return frame(T.absent.title, T.absent.h1, `<p class="face">${mk("void", T.absent.mk)} ${T.absent.face}</p>`);
  if (!info) return frame(T.lecture.title, T.lecture.h1, `<div class="charge" role="progressbar" aria-label="${esc(T.lecture.label)}"></div>`);
  const until = when(info.expiresAt, { sec: false });
  const kind = info.kind;
  const fleet = esc(titreFlotte(info.fleet));
  const create = (label) => `<div class="actions">${act("redeem", label, { k: "device" })}${act("redeem", T.onPhone, { q: true, k: "phone" })}</div>`;
  if (sub === "attente") return frame(T.attente.title, C.confirmOnDevice, `<p class="face">${T.attente.face}</p><div class="charge" role="progressbar" aria-label="${esc(T.attente.label)}"></div>`);
  if (sub === "annulee") return frame(T.annulee.title, T.annulee.h1, `<p class="face">${mk("void", T.annulee.mk)} ${T.annulee.face(until)}</p>${create(T.retry)}`);
  if (sub === "panne") return frame(T.panne.title, T.panne.h1, `<p class="face">${mk("inv", T.panne.mk)} ${T.panne.face}</p>${create(T.retry)}<p class="note">${T.panne.note}${reqNote(S.lastError)}</p>`);
  const st = info.state;
  if (st === "link-invalid") return frame(T.invalide.title, T.invalide.h1, `<p class="face">${mk("void", T.invalide.mk)} ${T.invalide.face}</p><div class="actions">${go("#/entree/connexion", C.goSignIn, { q: true })}</div>`);
  if (st === "link-signed-in") return frame(T.connecte.title, kind === "invitation" ? T.connecte.h1Invitation : T.connecte.h1, `<p class="face">${mk("full", T.connecte.mk)} ${T.connecte.face(fleet)}</p><div class="actions">${go("#/", C.openFleet)}</div>`);
  if (st === "link-used") return frame(T.servi.title, T.servi.h1, `<p class="face">${mk("void", T.servi.mk)} ${T.servi.face}${kind === "bootstrap" ? T.servi.bootstrap : ""}</p><div class="actions">${go("#/entree/connexion", C.signInPasskey)}</div><p class="note">${T.servi.note}</p>`);
  if (st === "link-expired") return frame(T.expire.title, kind === "recovery" ? T.expire.h1Recovery : kind === "invitation" ? T.expire.h1Invitation : T.expire.h1, `<p class="face">${mk("void", T.expire.mk)} ${T.expire.face(until)}</p><p class="note">${kind === "invitation" ? T.expire.invitation : T.expire.draw(kind === "recovery" ? "operateur:reprise" : "operateur:amorcage")}</p>`);
  if (st === "link-cancelled") return frame(kind === "recovery" ? T.annule.titleRecovery : T.annule.title, kind === "recovery" ? T.annule.h1Recovery : T.annule.h1, `<p class="face">${mk("void", T.annule.mk)} ${kind === "recovery" ? T.annule.faceRecovery : T.annule.face}</p>${kind === "recovery" ? `<p class="note">${T.annule.note}</p>` : ""}`);
  if (st === "link-not-yet") return frame(T.pasEncore.title, T.pasEncore.h1(when(info.usableFrom, { sec: false })), `<p class="face">${mk("half", T.pasEncore.mk)} ${T.pasEncore.face}</p><p class="note">${T.pasEncore.note}</p>`);
  if (kind === "recovery") return frame(T.reprise.title, T.reprise.h1(fleet), `<p class="face">${T.reprise.face}</p><ul class="effets">${T.reprise.effects.map((e) => `<li>${e}</li>`).join("")}</ul><p class="small">${T.reprise.once(until)}</p>${create(T.reprise.create)}`);
  if (kind === "invitation") return frame(T.invitation.title, T.invitation.h1(fleet), `<p class="face">${T.invitation.face(until)}</p>${create(T.invitation.create)}${pkPlain()}${forge()}`);
  return frame(T.amorcage.title, T.amorcage.h1, `<p class="face">${T.amorcage.face(until)}</p>${create(T.amorcage.create)}${pkPlain()}<p class="note">${T.amorcage.note}</p>`);
}
