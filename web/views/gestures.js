// Gestures: the sign-in, the verification a gesture asks, a write, a passkey added, a link redeemed, a
// confirmation.
import { S, parts } from "./base.js";
import { api, loadSession, loadAccess } from "./api.js";
import { ceremony, HINT } from "./webauthn.js";
import { KINDS } from "./confirm.js";
import { mots } from "./lexique.js";
import { say } from "./shell.js";
import { forgetReads, refreshScreen, rerender } from "./router.js";

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
  else if (!onArrival && !S.addError) location.hash = "#/acces";
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
  // the forge port (ADR-0029): a GitLab repository's protection and order epoch; a registered instance's key (its
  // confirmation names « <registration>.<key> ») and the registration itself
  liftprot: (id) => ["POST", `/api/v0/repositories/${id}/protection/lift`], restoreprot: (id) => ["POST", `/api/v0/repositories/${id}/protection/restore`], epoch: (id) => ["POST", `/api/v0/repositories/${id}/epoch`],
  keyretire: (id) => { const [issuer, key] = id.split("."); return ["DELETE", `/api/v0/issuers/${issuer}/keys/${key}`]; }, issuerremove: (id) => ["DELETE", `/api/v0/issuers/${id}`],
};
// what the page announces once a gesture is done: the lexicon's done.<kind>, else done.other
export async function confirmGesture(k) {
  const [kind, id] = k.split(":");
  const t = KINDS[kind];
  const erase = kind === "consent" && document.querySelector('input[name="sort"]:checked')?.value === "effacer";
  S.busy = k; S.failed = null; rerender();
  const [method, path] = ROUTE_OF[kind](id);
  const body = kind === "consent" ? { erase } : kind === "lang" ? { lang: id } : {};
  // the object a gesture is bound to: none, the object's id, or for a key retired the key's id alone
  const object = ["reader", "readeron", "closeothers", "lang"].includes(kind) ? "" : kind === "keyretire" ? id.split(".")[1] : id;
  const r = await write(method, path, body, { gesture: t.g, object });
  S.busy = null;
  if (!r.ok) { S.failed = k; S.failedText = r.message ? `${r.message} ${r.action ?? ""}` : null; return rerender(); }
  S.confirming = null;
  const done = mots().done;
  say(Object.hasOwn(done, kind) ? done[kind] : done.other);
  if ((kind === "passkey" && r.data?.closedCurrent) || (kind === "session" && r.data?.closedCurrent)) { S.session = null; S.closedBy = "passkey"; location.hash = "#/entree/session-fermee"; return; }
  S.focusKey = k;
  await refreshScreen();
}

// ------------------------------------------------------------- the forge port (ADR-0029)
/**
 * Confirm a repository. The gesture is bound to the repository and to the digest of the values the screen showed
 * (`pending.digest` of the access view): what is pinned is what the member saw. `confirmation-stale` says the values
 * changed since they were shown: the access view is read again and the screen shows the new ones.
 */
export async function confirmRepository(id) {
  const k = `confirm:${id}`;
  const digest = S.access?.repositories.find((r) => r.id === id)?.pending?.digest ?? "";
  S.failed = null; S.failedText = null; S.stale = null;
  const r = await write("POST", `/api/v0/repositories/${id}/confirm`, { digest }, { gesture: "repository-confirm", object: `${id}:${digest}` });
  if (!r.ok) {
    S.failed = k; S.failedText = r.message ? `${r.message} ${r.action ?? ""}` : null;
    if (r.refusal === "confirmation-stale") { S.stale = id; await loadAccess(); }
    return rerender();
  }
  say(r.data?.quarantine ? mots().done.confirmedQuarantine : mots().done.confirmed);
  await loadSession(); forgetReads(); location.hash = S.session.arrivalDone ? "#/" : "#/arrivee";
}

/** Where a refusal of a registration or of a key is shown: under its field, else above the form. */
const ISSUER_FIELD = { "issuer-malformed": "issuer", "issuer-not-allowed": "issuer", "key-malformed": "keys" };
function issuerRefused(r) {
  const x = r.data ? r : r.verify?.r ?? {};
  return { field: ISSUER_FIELD[x.refusal] ?? null, message: x.message ?? mots().common.verifyFailed, action: x.action ?? "", why: x.data?.why ?? null, requestId: x.requestId };
}
/** The key set the member pasted, as JSON: an object, or nothing. */
function keySet(text) {
  try { const v = JSON.parse(text); return v !== null && typeof v === "object" ? v : null; } catch { return null; }
}
/**
 * A registration (`id` empty) or a key of one, read before the gesture: the service answers the issuer, the kid, the
 * key's RFC 7638 thumbprint and the digest the gesture will be bound to, and writes nothing. The screen shows them.
 */
export async function issuerPreview(id, values) {
  const I = mots().forge.instance;
  S.issuer = { id, values, preview: null, error: null };
  const keys = keySet(values.keys);
  if (!keys) { S.issuer.error = { field: "keys", message: I.notJson, action: I.notJsonAction }; return rerender(); }
  const r = id ? await api("POST", `/api/v0/issuers/${id}/keys/preview`, { keys, kid: values.kid }) : await api("POST", "/api/v0/issuers/preview", { issuer: values.issuer, keys, kid: values.kid });
  if (r.ok) S.issuer.preview = r.data; else S.issuer.error = issuerRefused(r);
  return rerender();
}
/** The gesture on what the preview showed: `issuer-register` or `issuer-key-add`, bound to the preview's digest. */
export async function issuerWrite() {
  const f = S.issuer;
  if (!f?.preview) return;
  const keys = keySet(f.values.keys), digest = f.preview.digest, kid = f.values.kid;
  const r = f.id
    ? await write("POST", `/api/v0/issuers/${f.id}/keys`, { keys, kid, digest }, { gesture: "issuer-key-add", object: digest })
    : await write("POST", "/api/v0/issuers", { issuer: f.values.issuer, keys, kid, digest }, { gesture: "issuer-register", object: digest });
  // the values changed since they were shown: back to the input, to read them again
  if (!r.ok) { S.issuer = { ...f, preview: r.refusal === "confirmation-stale" ? null : f.preview, error: issuerRefused(r) }; return rerender(); }
  S.issuer = null;
  const done = mots().done;
  say(!f.id ? done.issuerRegistered : r.data?.confirmed ? done.keyConfirmed : done.keyAdded);
  await refreshScreen(); location.hash = "#/acces";
}
