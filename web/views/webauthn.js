// WebAuthn in the browser (JSON options from the server).

const b64u = { dec: (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)), enc: (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") };
const hasPasskeys = () => typeof window.PublicKeyCredential === "function" && !!navigator.credentials;
function creationOptions(o, hints) {
  if (PublicKeyCredential.parseCreationOptionsFromJSON) return PublicKeyCredential.parseCreationOptionsFromJSON({ ...o, ...(hints ? { hints } : {}) });
  return { ...o, challenge: b64u.dec(o.challenge), user: { ...o.user, id: b64u.dec(o.user.id) }, excludeCredentials: (o.excludeCredentials ?? []).map((c) => ({ ...c, id: b64u.dec(c.id) })), ...(hints ? { hints } : {}) };
}
function requestOptions(o, hints) {
  if (PublicKeyCredential.parseRequestOptionsFromJSON) return PublicKeyCredential.parseRequestOptionsFromJSON({ ...o, ...(hints ? { hints } : {}) });
  return { ...o, challenge: b64u.dec(o.challenge), allowCredentials: (o.allowCredentials ?? []).map((c) => ({ ...c, id: b64u.dec(c.id) })), ...(hints ? { hints } : {}) };
}
function credJSON(c) {
  if (typeof c.toJSON === "function") return c.toJSON();
  const r = c.response;
  return {
    id: c.id, rawId: b64u.enc(c.rawId), type: c.type, authenticatorAttachment: c.authenticatorAttachment ?? undefined, clientExtensionResults: c.getClientExtensionResults?.() ?? {},
    response: r.attestationObject
      ? { clientDataJSON: b64u.enc(r.clientDataJSON), attestationObject: b64u.enc(r.attestationObject), transports: r.getTransports?.() ?? [] }
      : { clientDataJSON: b64u.enc(r.clientDataJSON), authenticatorData: b64u.enc(r.authenticatorData), signature: b64u.enc(r.signature), userHandle: r.userHandle ? b64u.enc(r.userHandle) : undefined },
  };
}
/** A ceremony: { ok, response } or { ok: false, why: cancelled | exists | unsupported | offline }. */
export async function ceremony(kind, options, hints) {
  if (!hasPasskeys()) return { ok: false, why: "unsupported" };
  if (navigator.onLine === false) return { ok: false, why: "offline" };
  try {
    const c = kind === "create" ? await navigator.credentials.create({ publicKey: creationOptions(options, hints) }) : await navigator.credentials.get({ publicKey: requestOptions(options, hints) });
    return c ? { ok: true, response: credJSON(c) } : { ok: false, why: "cancelled" };
  } catch (e) {
    return { ok: false, why: e?.name === "InvalidStateError" ? "exists" : "cancelled" };
  }
}
export const HINT = { phone: ["hybrid"], key: ["security-key"], device: ["client-device"] };
