// Access: gestures that withdraw, then restore. One confirmation box for every gesture that asks one.
import { S, esc } from "./base.js";
import { mk } from "./marks.js";
import { mots, appareil } from "./lexique.js";

/**
 * The gestures that ask a confirmation: the per-gesture verification each one asks (`g`, null for a fresh one), and
 * whether it offers a choice. Their question, text and button are the lexicon's (confirm.kinds), by the same key.
 */
export const KINDS = {
  passkey: { g: "passkey-remove" }, session: { g: null }, repo: { g: null }, consent: { g: "consent-withdraw", choice: true }, consentir: { g: "consent" },
  purge: { g: "content-erase" }, restore: { g: null }, restorerepo: { g: null }, reader: { g: "reader-withdraw" }, readeron: { g: "reader-authorize" },
  closeothers: { g: null }, recovery: { g: "recovery-cancel" }, lang: { g: null },
  // the forge port (ADR-0029): a GitLab repository's protection and order epoch, a registered instance and its keys
  liftprot: { g: "protection-lift" }, restoreprot: { g: "protection-restore" }, epoch: { g: "order-epoch-open" },
  keyretire: { g: "issuer-key-retire" }, issuerremove: { g: "issuer-remove" },
};
export function confirmBox(k) {
  if (S.confirming !== k) return "";
  const [kind, id] = k.split(":");
  const W = mots(), C = W.confirm, t = { ...KINDS[kind], ...C.kinds[kind] };
  let d = t.d;
  if (kind === "passkey" && S.access) {
    const opened = S.access.sessions.filter((s) => s.openedBy === id);
    d = C.passkey(opened.map((s) => appareil(s.device) ?? C.device).join(", "), opened.some((s) => s.current));
  }
  // lifting the protection lowers the level: the sentence the uploads will then carry is said before the gesture
  if (kind === "liftprot") { const L = W.forge.level; d = `${t.d} ${L.said(L.P3b.proves, `${L.P3.not} ${L.P3b.not}`, L.code("P3b"))}`; }
  const geste = t.g ? W.common.askedForGesture : W.common.askedIfOld;
  if (S.busy === k) return `<div class="confirm" role="group" aria-label="${esc(t.q)}"><p><b>${esc(W.common.confirmOnDevice)}</b> ${esc(geste)}</p><div class="charge" role="progressbar" aria-label="${esc(W.common.waitingPasskey)}"></div></div>`;
  const failed = S.failed === k ? `<p class="erreur" role="alert">${mk("inv", W.common.notVerified)} ${esc(S.failedText ?? W.common.verifyFailed)}</p>` : "";
  const choice = t.choice ? `<fieldset class="choix"><legend class="k">${esc(C.keptLegend)}</legend>
      <label class="check"><input type="radio" name="sort" value="garder" checked><span>${esc(C.keep)}</span></label>
      <label class="check"><input type="radio" name="sort" value="effacer"><span>${esc(C.erase)}</span></label></fieldset>` : "";
  return `<div class="confirm" role="group" aria-label="${esc(t.q)}">${failed}<p><b>${esc(t.q)}</b> ${esc(d)}</p>${choice}
    <p class="small soft">${esc(geste)}</p>
    <div class="actions"><button class="btn" type="button" data-do="confirm" data-k="${esc(k)}" data-focus>${esc(t.b)}</button><button class="btn btn-q" type="button" data-do="cancel">${esc(W.common.cancel)}</button></div></div>`;
}
export const ask = (k, label, q = true) => `<button class="${q ? "btn btn-q" : "lien-btn"}" type="button" data-do="ask" data-k="${esc(k)}" data-focus-key="${esc(k)}">${esc(label)}</button>`;
