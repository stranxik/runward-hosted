// Gestures: the sign-in, the verification a gesture asks, a write, a passkey added, a link redeemed, a
// confirmation.
import { S, parts } from "./base.js";
import { api, loadSession } from "./api.js";
import { ceremony, HINT } from "./webauthn.js";
import { KINDS } from "./confirm.js";
import { mots } from "./lexique.js";
import { say } from "./shell.js";
import { forgetReads, refreshScreen, rerender } from "./router.js";
import { retour, versSection, versDepot } from "./liens.js";

export async function signIn(mode) {
  location.hash = "#/entree/attente";
  const o = await api("POST", "/api/v0/auth/options", {});
  if (!o.ok) { S.error = o; location.hash = "#/panne"; return; }
  const c = await ceremony("get", o.data.options, HINT[mode]);
  if (!c.ok) { location.hash = c.why === "unsupported" ? "#/entree/sans-passkey" : c.why === "offline" ? "#/panne/hors-ligne" : "#/entree/echec"; return; }
  const r = await api("POST", "/api/v0/auth/verify", { challengeId: o.data.challengeId, response: c.response });
  if (!r.ok) { location.hash = r.refusal === "passkey-unknown" ? "#/entree/inconnue" : r.refusal === "challenge-invalid" ? "#/entree/expiree" : "#/entree/echec"; return; }
  await loadSession(); forgetReads();
  const back = S.intent; S.intent = null;
  location.hash = !S.session.arrivalDone ? "#/arrivee" : back && !back.startsWith("#/entree") ? back : "#/";
}

/** A fresh verification, bound to a gesture and its object when one is named. */
async function verify(gesture = null, object = null) {
  const o = await api("POST", "/api/v0/auth/fresh/options", gesture ? { gesture, object } : {});
  if (!o.ok) return { ok: false, r: o };
  const c = await ceremony("get", o.data.options);
  if (!c.ok) return { ok: false, why: c.why };
  const r = await api("POST", "/api/v0/auth/fresh", { challengeId: o.data.challengeId, response: c.response });
  if (r.ok && !gesture) S.freshUntil = Date.parse(r.data.until);
  return r.ok ? { ok: true } : { ok: false, r };
}
/** Run a write: per-gesture verification when `gesture`, else a fresh one when the server asks for it. */
export async function write(method, path, body, { gesture = null, object = "" } = {}) {
  if (gesture) { const v = await verify(gesture, object); if (!v.ok) return { ok: false, verify: v }; }
  // every other write asks a verification less than 5 minutes old: ask it first when this page knows it lapsed
  else if (!(S.freshUntil > Date.now() + 15_000)) { const v = await verify(); if (!v.ok) return { ok: false, verify: v }; }
  let r = await api(method, path, body);
  if (r.refusal === "fresh-required") { const v = await verify(); if (!v.ok) return { ok: false, verify: v }; r = await api(method, path, body); }
  return r;
}

export async function addPasskey(mode) {
  S.addError = null;
  const v = await verify("passkey-add", "");
  if (!v.ok) { S.addError = "cancelled"; return refreshAfterAdd(); }
  const o = await api("POST", "/api/v0/passkeys/options", {});
  if (!o.ok) { S.addError = o.refusal === "passkey-exists" ? "exists" : "cancelled"; return refreshAfterAdd(); }
  const c = await ceremony("create", o.data.options, HINT[mode]);
  if (!c.ok) { S.addError = c.why === "exists" ? "exists" : "cancelled"; return refreshAfterAdd(); }
  const r = await api("POST", "/api/v0/passkeys", { challengeId: o.data.challengeId, response: c.response });
  if (!r.ok) S.addError = r.refusal === "passkey-exists" ? "exists" : "cancelled";
  else say(mots().done.passkeyAdded);
  return refreshAfterAdd();
}
async function refreshAfterAdd() {
  const onArrival = parts().route === "arrivee";
  await refreshScreen();
  if (onArrival && S.addError) location.hash = S.addError === "exists" ? "#/arrivee/seconde-existe" : "#/arrivee/seconde-annulee";
  else if (!onArrival && !S.addError) location.hash = retour(versSection("cles"));
  else rerender();
}

export async function redeem(mode) {
  const token = S.link;
  location.hash = "#/lien/attente";
  const o = await api("POST", "/api/v0/links/options", { token });
  if (!o.ok) { S.linkInfo = { ...S.linkInfo, state: o.refusal?.startsWith("link-") ? o.refusal : S.linkInfo.state }; location.hash = "#/lien"; return; }
  const c = await ceremony("create", o.data.options, HINT[mode]);
  if (!c.ok) { location.hash = c.why === "unsupported" ? "#/entree/sans-passkey" : "#/lien/annulee"; return; }
  const r = await api("POST", "/api/v0/links/redeem", { token, challengeId: o.data.challengeId, response: c.response });
  if (!r.ok) {
    if (r.network || r.status >= 500) {
      S.lastError = r;
      try { await PublicKeyCredential.signalUnknownCredential?.({ rpId: location.hostname, credentialId: c.response.id }); } catch { /* the browser may not offer it */ }
      location.hash = "#/lien/panne"; return;
    }
    S.linkInfo = { ...S.linkInfo, state: r.refusal?.startsWith("link-") ? r.refusal : "link-live" };
    location.hash = r.refusal?.startsWith("link-") ? "#/lien" : "#/lien/annulee"; return;
  }
  S.link = null;
  await loadSession(); forgetReads();
  location.hash = "#/arrivee";
}

const ROUTE_OF = {
  passkey: (id) => ["DELETE", `/api/v0/passkeys/${id}`], restore: (id) => ["POST", `/api/v0/passkeys/${id}/restore`], session: (id) => ["DELETE", `/api/v0/sessions/${id}`],
  repo: (id) => ["DELETE", `/api/v0/repositories/${id}`], restorerepo: (id) => ["POST", `/api/v0/repositories/${id}/restore`], consentir: (id) => ["POST", `/api/v0/repositories/${id}/consent`],
  consent: (id) => ["DELETE", `/api/v0/repositories/${id}/consent`], purge: (id) => ["DELETE", `/api/v0/repositories/${id}/content`], reader: () => ["DELETE", "/api/v0/reader"],
  readeron: () => ["POST", "/api/v0/reader"], closeothers: () => ["POST", "/api/v0/sessions/close-others"], recovery: () => ["POST", "/api/v0/recovery/cancel"], lang: () => ["POST", "/api/v0/tenant/settings"],
};
// what the page announces once a gesture is done: the lexicon's done.<kind>, else done.other
export async function confirmGesture(k) {
  const [kind, id] = k.split(":");
  const t = KINDS[kind];
  const erase = kind === "consent" && document.querySelector('input[name="sort"]:checked')?.value === "effacer";
  S.busy = k; S.failed = null; rerender();
  const [method, path] = ROUTE_OF[kind](id);
  const body = kind === "consent" ? { erase } : kind === "lang" ? { lang: id } : {};
  const object = ["reader", "readeron", "closeothers", "lang"].includes(kind) ? "" : kind === "recovery" ? id : id;
  const r = await write(method, path, body, { gesture: t.g, object });
  S.busy = null;
  if (!r.ok) { S.failed = k; S.failedText = r.message ? `${r.message} ${r.action ?? ""}` : null; return rerender(); }
  S.confirming = null;
  const done = mots().done;
  say(Object.hasOwn(done, kind) ? done[kind] : done.other);
  if ((kind === "passkey" && r.data?.closedCurrent) || (kind === "session" && r.data?.closedCurrent)) { S.session = null; S.closedBy = "passkey"; location.hash = "#/entree/session-fermee"; return; }
  S.focusKey = k;
  await refreshScreen();
  // a repository removed from its confirmation (« ce n'est pas mon dépôt »): that screen has nothing left to do
  if (kind === "repo" && parts().route === "declarer") location.hash = retour(versDepot(id));
}
