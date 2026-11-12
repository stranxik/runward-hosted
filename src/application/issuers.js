// A GitLab instance a tenant registers, and its keys (ADR-0029 section 4). Every gesture here is a
// passkey gesture bound to what the screen shows: registering and adding a key to the digest of the
// issuer's string and of the key's thumbprint, retiring a key and removing a registration to their
// identifier. Each is journaled and written to the security log before the transaction commits; the ones
// that withdraw an access (a key retired, a registration removed) are replayed after a restore (T24).
// The service never calls the instance: the member pastes its key set, and one key is kept.
import { randomBytes } from "node:crypto";
import { Refusal } from "../domain/refusals/index.js";
import { readIssuer, readKeyInput, checkKeyAddable, checkRegistrable, keyState, keyExpiresAt, keyWarned, indexNameOf } from "../domain/issuer.js";
import { registrationDigest, sendAudience, REGISTRATION_ID } from "../domain/forge.js";
import { REMOVED_KEEP } from "../domain/repository.js";
import { StoreConflict } from "../ports/errors.js";
import { iso } from "./context.js";

const human = (s) => ({ type: "human", id: s.memberId });
const UUID = /^[0-9a-f-]{36}$/;

/** A registration as the app shows it: its audience, its keys and their state; never a key's material beyond its thumbprint. */
export function issuerView(i, keys, origin, nowMs) {
  const mine = keys.filter((k) => k.issuerRef === i.id).sort((a, b) => a.addedAt - b.addedAt);
  const view = mine.map((k) => ({ id: k.id, kid: k.kid, thumbprint: k.thumbprint, state: keyState(k, nowMs), addedAt: iso(k.addedAt), confirmedAt: iso(k.confirmedAt), retiredAt: iso(k.retiredAt), expiresAt: iso(keyExpiresAt(k)), expiresSoon: keyWarned(k, nowMs) }));
  return { id: i.id, forge: i.forge, issuer: i.issuer, audience: sendAudience(origin, i.id), addedAt: iso(i.addedAt), keys: view, receiving: view.some((k) => k.state === "live") };
}

export function issuerCases(ctx, identity) {
  const { store, clock, append, security } = ctx;
  const { useGesture } = identity;
  const now = () => clock.now();
  const origin = ctx.config.origin;
  const serviceHosts = [new URL(origin).host, ...(ctx.config.hosts ?? [])];

  /** What the screen shows before the gesture, and the digest the gesture is bound to. Writes nothing. */
  function readRegistration(input) {
    const i = readIssuer(input?.issuer, { serviceHosts });
    // The index names the instance's repositories host[:port]/path (ADR-0029 section 1): an instance whose
    // host or port the pinned runward-fleet cannot name (an IP address, a last label that starts with a digit,
    // port 0, a port with a leading zero) is refused here, asked of the library itself, so that no repository
    // is ever declared on it and no tenant's assembly is refused later because of it (ADR-0033).
    if (!ctx.ports.assembler.admits(indexNameOf(i.issuer, "group/project"))) throw new Refusal("issuer-malformed", { why: "the host is not a name the fleet view can write (no IP address, a last label that starts with a letter), and the port is 1 to 65535 without a leading zero" });
    const k = readKeyInput(input?.keys, input?.kid);
    return { issuer: i.issuer, ...k, digest: registrationDigest("issuer-register", [i.issuer, k.thumbprint]) };
  }
  function readKey(id, input) {
    const k = readKeyInput(input?.keys, input?.kid);
    return { ...k, digest: registrationDigest("issuer-key-add", [id, k.thumbprint]) };
  }
  const shown = (d) => ({ kid: d.kid, thumbprint: d.thumbprint, bits: d.bits, digest: d.digest, ...(d.issuer ? { issuer: d.issuer } : {}) });

  async function registration(tx, id) {
    if (typeof id !== "string" || !REGISTRATION_ID.test(id)) throw new Refusal("not-found");
    const i = await tx.get("issuer", { id });
    if (!i || i.removedAt) throw new Refusal("not-found");
    return i;
  }

  async function preview(s, input) { return shown(readRegistration(input)); }

  async function register(s, input, { requestId }) {
    const d = readRegistration(input);
    if (input?.digest !== d.digest) throw new Refusal("confirmation-stale", { digest: d.digest });
    try {
      return await store.tx(s.tenantId, async (tx) => {
        await useGesture(tx, s, "issuer-register", d.digest);
        await tx.lockTenant();
        checkRegistrable(await tx.list("issuer"));
        // 128 random bits: the registration's identifier, the last segment of its audience, its issuer key
        const id = randomBytes(16).toString("hex");
        await tx.insert("issuer", { id, forge: "gitlab", issuer: d.issuer, addedAt: now() });
        await tx.insert("issuer_key", { id: store.newId(), issuerRef: id, kid: d.kid, jwk: d.jwk, thumbprint: d.thumbprint, addedAt: now(), confirmedAt: now() });
        await security(tx, { what: "issuer-registered", issuer: id, kid: d.kid, thumbprint: d.thumbprint });
        const e = await append(tx, { who: human(s), what: "issuer-registered", object: id, requestId, detail: { forge: "gitlab", issuer: d.issuer, kid: d.kid, thumbprint: d.thumbprint, bits: d.bits } });
        return { id, issuer: d.issuer, audience: sendAudience(origin, id), kid: d.kid, thumbprint: d.thumbprint, entry: e };
      });
    } catch (e) {
      if (e instanceof StoreConflict) throw new Refusal("service-unavailable");
      throw e;
    }
  }

  async function keyPreview(s, id, input) {
    await store.tx(s.tenantId, (tx) => registration(tx, id));
    return shown(readKey(id, input));
  }

  /** Add a key, or confirm again a key already held (which moves its expiry): bound to the key shown. */
  async function keyAdd(s, id, input, { requestId }) {
    if (typeof id !== "string" || !REGISTRATION_ID.test(id)) throw new Refusal("not-found");
    const d = readKey(id, input);
    if (input?.digest !== d.digest) throw new Refusal("confirmation-stale", { digest: d.digest });
    try {
      return await store.tx(s.tenantId, async (tx) => {
        await useGesture(tx, s, "issuer-key-add", d.digest);
        await tx.lockTenant();
        const i = await registration(tx, id);
        const held = checkKeyAddable(await tx.list("issuer_key", { issuerRef: i.id }), d.kid, now());
        const what = held ? "issuer-key-confirmed" : "issuer-key-added";
        const keyId = held ? held.id : store.newId();
        if (held) await tx.update("issuer_key", { id: held.id }, { confirmedAt: now() });
        else await tx.insert("issuer_key", { id: keyId, issuerRef: i.id, kid: d.kid, jwk: d.jwk, thumbprint: d.thumbprint, addedAt: now(), confirmedAt: now() });
        if (held) await security(tx, { what: "issuer-key-confirmed", issuer: i.id, key: keyId, kid: d.kid, thumbprint: d.thumbprint });
        else await security(tx, { what: "issuer-key-added", issuer: i.id, key: keyId, kid: d.kid, thumbprint: d.thumbprint });
        const e = await append(tx, { who: human(s), what, object: i.id, requestId, detail: { kid: d.kid, thumbprint: d.thumbprint, bits: d.bits } });
        return { key: keyId, kid: d.kid, thumbprint: d.thumbprint, confirmed: Boolean(held), entry: e };
      });
    } catch (e) {
      if (e instanceof StoreConflict) throw new Refusal("key-exists");
      throw e;
    }
  }

  /** Retire a key, the last one included: it takes effect at once, and the key is kept, marked. */
  async function keyRetire(s, id, keyId, { requestId }) {
    if (typeof keyId !== "string" || !UUID.test(keyId)) throw new Refusal("not-found");
    return store.tx(s.tenantId, async (tx) => {
      await useGesture(tx, s, "issuer-key-retire", keyId);
      const i = await registration(tx, id);
      const k = await tx.get("issuer_key", { id: keyId });
      if (!k || k.issuerRef !== i.id || k.retiredAt) throw new Refusal("not-found");
      await tx.update("issuer_key", { id: k.id }, { retiredAt: now() });
      await security(tx, { what: "issuer-key-retired", issuer: i.id, key: k.id, kid: k.kid, thumbprint: k.thumbprint });
      const e = await append(tx, { who: human(s), what: "issuer-key-retired", object: i.id, requestId, detail: { kid: k.kid, thumbprint: k.thumbprint } });
      const live = (await tx.list("issuer_key", { issuerRef: i.id })).filter((x) => keyState(x, now()) === "live").length;
      return { entry: e, receiving: live > 0 };
    });
  }

  /** Remove a registration: refused while a repository is declared on it, or could still be restored. */
  async function remove(s, id, { requestId }) {
    return store.tx(s.tenantId, async (tx) => {
      await useGesture(tx, s, "issuer-remove", id);
      const i = await registration(tx, id);
      const declared = (await tx.list("forge_repository", { issuerKey: i.id })).filter((f) => !f.removedAt || now() - f.removedAt < REMOVED_KEEP);
      if (declared.length) throw new Refusal("issuer-in-use", { repositories: declared.length });
      await tx.update("issuer", { id: i.id }, { removedAt: now() });
      await security(tx, { what: "issuer-removed", issuer: i.id });
      return { entry: await append(tx, { who: human(s), what: "issuer-removed", object: i.id, requestId, detail: { issuer: i.issuer } }) };
    });
  }

  return { preview, register, keyPreview, keyAdd, keyRetire, remove };
}
