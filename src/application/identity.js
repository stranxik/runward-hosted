// Human identity use cases (PADR-0012 and its notes): sessions, sign-in, fresh and per-gesture
// verification, the links that open an access (bootstrap, recovery, invitation), passkeys and sessions
// on the Access screen. Every challenge is consumed in its own transaction BEFORE the ceremony is
// verified, so a replayed challenge fails even when the ceremony would pass.
import { Refusal } from "../domain/refusals.js";
import {
  linkState, sessionOpen, requireFresh, requireGesture, checkRemovable, checkRestorable, sameProvider,
  meaningfulAaguid, providerOf, deviceFromUserAgent, arrivalOpen, MAX_PASSKEYS, PASSKEY_RESTORE_WINDOW, FRESH_WINDOW,
} from "../domain/identity.js";
import { StoreConflict } from "../ports/errors.js";
import { sha256, newToken, iso } from "./context.js";

const human = (s) => ({ type: "human", id: s.memberId });

export function identityCases(ctx) {
  const { store, clock, append, security } = ctx;
  const { authn } = ctx.ports;
  const now = () => clock.now();

  // ---------------------------------------------------------------- sessions
  /** The session a cookie token designates, touched; null when absent, closed or expired. */
  async function sessionFrom(token) {
    if (!token || token.length > 100) return null;
    const hash = sha256(token);
    const r = await store.tx(null, (tx) => tx.resolveSession(hash));
    if (!r) return null;
    return store.tx(r.tenantId, async (tx) => {
      const s = await tx.get("session", { id: r.id });
      if (!s || !sessionOpen(s, now())) return null;
      const m = await tx.get("member", { id: s.memberId });
      if (!m || m.removedAt) return null;
      if (now() - s.lastSeenAt > 60_000) await tx.update("session", { id: s.id }, { lastSeenAt: now() });
      return { ...s, tenantId: r.tenantId, member: m };
    });
  }

  async function openSession(tx, { memberId, passkeyId, ua }) {
    const token = newToken();
    const s = await tx.insert("session", { id: store.newId(), tokenHash: sha256(token), memberId, passkeyId, device: deviceFromUserAgent(ua), createdAt: now(), lastSeenAt: now(), freshAt: now(), freshBy: passkeyId });
    return { token, session: s };
  }

  // ---------------------------------------------------------------- sign-in
  async function signInOptions() {
    const options = await authn.authenticationOptions({});
    const id = store.newId();
    await store.tx(null, (tx) => tx.putChallenge({ id, challenge: options.challenge, purpose: "signin" }));
    return { challengeId: id, options };
  }

  async function take(challengeId, purpose) {
    if (typeof challengeId !== "string" || !/^[0-9a-f-]{36}$/.test(challengeId)) throw new Refusal("challenge-invalid");
    const c = await store.tx(null, (tx) => tx.takeChallenge(challengeId));
    if (!c || !c.live || c.purpose !== purpose) throw new Refusal("challenge-invalid");
    return c;
  }

  async function signIn({ challengeId, response, ua, requestId }) {
    const c = await take(challengeId, "signin");
    const credId = typeof response?.id === "string" ? response.id : null;
    const r = credId ? await store.tx(null, (tx) => tx.resolveCredential(credId)) : null;
    if (!r) throw new Refusal("passkey-unknown");
    const pk = await store.tx(r.tenantId, (tx) => tx.get("passkey", { id: r.passkeyId }));
    if (!pk || pk.removedAt) throw new Refusal("passkey-unknown");
    const v = await authn.verifyAuthentication({ response, expectedChallenge: c.challenge, credential: pk });
    if (!v) throw new Refusal("ceremony-failed");
    return store.tx(r.tenantId, async (tx) => {
      const m = await tx.get("member", { id: pk.memberId });
      if (!m || m.removedAt) throw new Refusal("passkey-unknown");
      await tx.update("passkey", { id: pk.id }, { counter: v.newCounter, lastUsedAt: now() });
      const opened = await openSession(tx, { memberId: m.id, passkeyId: pk.id, ua });
      await append(tx, { who: { type: "human", id: m.id }, what: "signed-in", object: opened.session.id, requestId, detail: { passkey: pk.id } });
      return { token: opened.token, tenantId: r.tenantId };
    });
  }

  async function signOut(s, { requestId }) {
    await store.tx(s.tenantId, async (tx) => {
      await tx.update("session", { id: s.id }, { closedAt: now() });
      await append(tx, { who: human(s), what: "signed-out", object: s.id, requestId });
    });
  }

  // ---------------------------------------------------------------- fresh and per-gesture verification
  async function livePasskeys(tx, memberId) { return (await tx.list("passkey", { memberId })).filter((p) => !p.removedAt); }

  async function freshOptions(s, { gesture = null, object = null } = {}) {
    const allow = await store.tx(s.tenantId, (tx) => livePasskeys(tx, s.memberId));
    const options = await authn.authenticationOptions({ allow });
    const id = store.newId();
    await store.tx(null, (tx) => tx.putChallenge({ id, challenge: options.challenge, purpose: "fresh", sessionId: s.id, gesture, object: object == null ? null : String(object) }));
    return { challengeId: id, options };
  }

  async function fresh(s, { challengeId, response, requestId }) {
    const c = await take(challengeId, "fresh");
    if (c.sessionId !== s.id) throw new Refusal("challenge-invalid");
    const pk = await store.tx(s.tenantId, async (tx) => (await livePasskeys(tx, s.memberId)).find((p) => p.credentialId === response?.id) ?? null);
    if (!pk) throw new Refusal("fresh-failed");
    const v = await authn.verifyAuthentication({ response, expectedChallenge: c.challenge, credential: pk });
    if (!v) throw new Refusal("fresh-failed");
    await store.tx(s.tenantId, async (tx) => {
      await tx.update("passkey", { id: pk.id }, { counter: v.newCounter, lastUsedAt: now() });
      await tx.update("session", { id: s.id }, { freshAt: now(), freshBy: pk.id, grant: c.gesture ? { gesture: c.gesture, object: c.object ?? "", at: now() } : s.grant });
    });
    return { fresh: true, until: iso(now() + FRESH_WINDOW), gesture: c.gesture ?? null };
  }

  /** Consume the per-gesture grant inside the gesture's own transaction (single use). */
  async function useGesture(tx, s, gesture, object) {
    const cur = await tx.get("session", { id: s.id });
    requireGesture(cur, gesture, object, now());
    await tx.update("session", { id: s.id }, { grant: null });
  }
  async function useFresh(tx, s) {
    const cur = await tx.get("session", { id: s.id });
    requireFresh(cur, now());
    return cur;
  }

  // ---------------------------------------------------------------- links (5 bis)
  async function resolveLink(token) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
    const r = await store.tx(null, (tx) => tx.resolveLink(sha256(token)));
    if (!r) return null;
    const link = await store.tx(r.tenantId, (tx) => tx.get("link", { id: r.id }));
    return link ? { ...link, tenantId: r.tenantId } : null;
  }

  async function inspectLink({ token, session }) {
    const link = await resolveLink(token);
    const state = linkState(link, now(), { signedInTenant: session?.tenantId ?? null });
    if (state === "link-invalid") return { state };
    const tenant = await store.tx(link.tenantId, (tx) => tx.get("tenant", { id: link.tenantId }));
    return { state, kind: link.kind, usableFrom: iso(link.usableFrom), expiresAt: iso(link.expiresAt), fleet: tenant.title };
  }

  async function linkOptions({ token, session }) {
    const link = await resolveLink(token);
    const state = linkState(link, now(), { signedInTenant: session?.tenantId ?? null });
    if (state !== "link-live") throw new Refusal(state);
    const memberId = link.kind === "recovery" ? link.memberId : store.newId();
    const options = await authn.registrationOptions({ memberId, label: link.kind === "bootstrap" ? "fondateur" : "membre", exclude: [] });
    const id = store.newId();
    await store.tx(null, (tx) => tx.putChallenge({ id, challenge: options.challenge, purpose: "link", linkId: link.id, object: memberId }));
    return { challengeId: id, options };
  }

  async function redeemLink({ token, challengeId, response, ua, requestId }) {
    const c = await take(challengeId, "link");
    const link0 = await resolveLink(token);
    if (!link0 || link0.id !== c.linkId) throw new Refusal("link-invalid");
    const reg = await authn.verifyRegistration({ response, expectedChallenge: c.challenge });
    if (!reg) throw new Refusal("ceremony-failed");
    try {
      return await store.tx(link0.tenantId, async (tx) => {
        await tx.lockTenant();
        const link = await tx.get("link", { id: link0.id });
        const state = linkState(link, now());
        if (state !== "link-live") throw new Refusal(state);
        const members = (await tx.list("member")).filter((m) => !m.removedAt);
        let memberId = c.object;
        let what;
        if (link.kind === "bootstrap") {
          if (members.length) throw new Refusal("link-used");
          await tx.insert("member", { id: memberId, role: "owner", founder: true, label: "fondateur", addedAt: now() });
          what = "member-founded";
        } else if (link.kind === "recovery") {
          memberId = link.memberId;
          if (!members.some((m) => m.id === memberId)) throw new Refusal("link-invalid");
          for (const p of await tx.list("passkey", { memberId })) if (!p.removedAt) await tx.update("passkey", { id: p.id }, { removedAt: now(), lost: true });
          for (const s of await tx.list("session")) if (!s.closedAt) await tx.update("session", { id: s.id }, { closedAt: now() });
          what = "member-recovered";
        } else {
          await tx.insert("member", { id: memberId, role: "owner", label: "membre", addedAt: now() });
          what = "member-founded";
        }
        const passkeyId = store.newId();
        await tx.insert("passkey", { id: passkeyId, memberId, credentialId: reg.credentialId, publicKey: reg.publicKey, counter: reg.counter, transports: reg.transports, aaguid: meaningfulAaguid(reg.aaguid), device: deviceFromUserAgent(ua), via: reg.deviceType ?? null, createdAt: now() });
        await tx.update("link", { id: link.id }, { usedAt: now() });
        const opened = await openSession(tx, { memberId, passkeyId, ua });
        await security(tx, { what, link: link.id, member: memberId, passkey: passkeyId });
        const e = await append(tx, { who: { type: "human", id: memberId }, what, object: link.id, requestId, detail: { kind: link.kind, passkey: passkeyId } });
        return { token: opened.token, tenantId: link0.tenantId, entry: e };
      });
    } catch (e) {
      if (e instanceof StoreConflict) throw new Refusal(e.constraint.includes("credential") ? "passkey-exists" : "link-used");
      throw e;
    }
  }

  // ---------------------------------------------------------------- the session view and the Access screen
  const passkeyView = (p, currentPasskey) => ({
    id: p.id,
    provider: providerOf(p.aaguid),
    device: p.device,
    synced: p.via === "multiDevice" ? true : p.via === "singleDevice" ? false : null,
    phone: Array.isArray(p.transports) && p.transports.includes("hybrid"),
    createdAt: iso(p.createdAt),
    lastUsedAt: iso(p.lastUsedAt),
    removedAt: iso(p.removedAt),
    restorableUntil: p.removedAt && !p.lost ? iso(p.removedAt + PASSKEY_RESTORE_WINDOW) : null,
    current: p.id === currentPasskey,
  });

  async function sessionView(s) {
    return store.tx(s.tenantId, async (tx) => {
      const tenant = await tx.get("tenant", { id: s.tenantId });
      const pks = await tx.list("passkey", { memberId: s.memberId });
      const live = pks.filter((p) => !p.removedAt);
      const repos = (await tx.list("repository")).filter((r) => !r.removedAt);
      const recovery = (await tx.list("link", { kind: "recovery" })).find((l) => !l.usedAt && !l.cancelledAt && now() < l.expiresAt) ?? null;
      const added = pks.filter((p) => !p.removedAt && p.id !== s.passkeyId && p.createdAt > s.createdAt && p.addedBySession !== s.id);
      const maintenance = await tx.maintenance();
      const open = arrivalOpen(pks, Boolean(s.member.singlePasskeyAt));
      return {
        member: { id: s.memberId, role: s.member.role },
        tenant: { id: s.tenantId, title: tenant.title, lang: tenant.lang },
        fleets: [{ id: s.tenantId, title: tenant.title }],
        passkeys: live.length,
        sameProvider: sameProvider(pks),
        single: Boolean(s.member.singlePasskeyAt),
        recovery: recovery ? { id: recovery.id, openedAt: iso(recovery.openedAt), usableFrom: iso(recovery.usableFrom), expiresAt: iso(recovery.expiresAt) } : null,
        addedElsewhere: added.map((p) => ({ id: p.id, createdAt: iso(p.createdAt), provider: providerOf(p.aaguid), device: p.device })),
        maintenance: maintenance ?? null,
        arrivalOpen: open,
        arrivalDone: open && repos.some((r) => r.confirmedAt),
        fresh: Boolean(s.freshAt && now() - s.freshAt < FRESH_WINDOW),
      };
    });
  }

  async function accessView(s) {
    return store.tx(s.tenantId, async (tx) => {
      const pks = await tx.list("passkey", { memberId: s.memberId });
      const sessions = (await tx.list("session", { memberId: s.memberId })).filter((x) => sessionOpen(x, now()));
      const repos = await tx.list("repository");
      const forge = await tx.list("forge_repository");
      const missions = await tx.list("mission");
      const reader = await tx.get("reader", {});
      const recovery = (await tx.list("link", { kind: "recovery" })).find((l) => !l.usedAt && !l.cancelledAt && now() < l.expiresAt) ?? null;
      const tenant = await tx.get("tenant", { id: s.tenantId });
      const label = (id) => { const p = pks.find((x) => x.id === id); return p ? providerOf(p.aaguid) ?? p.device ?? null : null; };
      return {
        passkeys: pks.filter((p) => !p.removedAt || (!p.lost && now() - p.removedAt < PASSKEY_RESTORE_WINDOW)).map((p) => passkeyView(p, s.passkeyId)),
        sameProvider: sameProvider(pks),
        single: Boolean(s.member.singlePasskeyAt),
        sessions: sessions.map((x) => ({ id: x.id, device: x.device, openedBy: x.passkeyId, openedByLabel: label(x.passkeyId), createdAt: iso(x.createdAt), lastSeenAt: iso(x.lastSeenAt), current: x.id === s.id })),
        repositories: repos.filter((r) => !r.removedAt || now() - r.removedAt < 30 * 86_400_000).map((r) => {
          const f = forge.find((x) => x.id === r.id);
          return {
            id: r.id, name: r.name, workflow: r.workflow, defaultBranch: r.defaultBranch ?? "main", state: r.removedAt ? "removed" : f?.state ?? "pending", consent: r.consent, consentAt: iso(r.consentAt),
            declaredAt: iso(r.declaredAt), confirmedAt: iso(r.confirmedAt), removedAt: iso(r.removedAt), restorableUntil: r.removedAt ? iso(r.removedAt + 30 * 86_400_000) : null,
            expiresAt: f?.state === "pending" ? iso(r.declaredAt + 7 * 86_400_000) : null,
            repositoryId: f?.repositoryId ?? null, ownerId: f?.ownerId ?? null,
            missions: missions.filter((m) => m.repositoryRef === r.id && !m.removedAt).map((m) => ({ id: m.id, path: m.path })),
            pendingSend: r.pendingSend ?? null,
          };
        }),
        reader: reader && reader.authorizedAt && !reader.withdrawnAt ? { authorizedAt: iso(reader.authorizedAt), workflow: "stranxik/runward-hosted/.github/workflows/temoin.yml" } : null,
        recovery: recovery ? { id: recovery.id, openedAt: iso(recovery.openedAt), usableFrom: iso(recovery.usableFrom), expiresAt: iso(recovery.expiresAt) } : null,
        lang: tenant.lang,
        retention: { removedRepositoryDays: 30, backupDays: 7, archiveHours: 24 },
      };
    });
  }

  // ---------------------------------------------------------------- passkeys (2 bis, T27)
  async function passkeyAddOptions(s) {
    const exclude = await store.tx(s.tenantId, async (tx) => {
      const cur = await tx.get("session", { id: s.id });
      requireGesture(cur, "passkey-add", "", now());
      return tx.list("passkey", { memberId: s.memberId });
    });
    if (exclude.filter((p) => !p.removedAt).length >= MAX_PASSKEYS) throw new Refusal("passkey-exists");
    const options = await authn.registrationOptions({ memberId: s.memberId, label: s.member.label ?? "membre", exclude });
    const id = store.newId();
    await store.tx(null, (tx) => tx.putChallenge({ id, challenge: options.challenge, purpose: "add", sessionId: s.id }));
    return { challengeId: id, options };
  }

  async function passkeyAdd(s, { challengeId, response, ua, requestId }) {
    const c = await take(challengeId, "add");
    if (c.sessionId !== s.id) throw new Refusal("challenge-invalid");
    const reg = await authn.verifyRegistration({ response, expectedChallenge: c.challenge });
    if (!reg) throw new Refusal("ceremony-failed");
    try {
      return await store.tx(s.tenantId, async (tx) => {
        await useGesture(tx, s, "passkey-add", "");
        const id = store.newId();
        await tx.insert("passkey", { id, memberId: s.memberId, credentialId: reg.credentialId, publicKey: reg.publicKey, counter: reg.counter, transports: reg.transports, aaguid: meaningfulAaguid(reg.aaguid), device: deviceFromUserAgent(ua), via: reg.deviceType ?? null, createdAt: now(), addedBySession: s.id });
        await security(tx, { what: "passkey-added", member: s.memberId, passkey: id });
        const e = await append(tx, { who: human(s), what: "passkey-added", object: id, requestId });
        const pks = await tx.list("passkey", { memberId: s.memberId });
        return { id, entry: e, sameProvider: sameProvider(pks), passkeys: pks.filter((p) => !p.removedAt).length };
      });
    } catch (e) {
      if (e instanceof StoreConflict) throw new Refusal("passkey-exists");
      throw e;
    }
  }

  async function passkeySingle(s, { requestId }) {
    return store.tx(s.tenantId, async (tx) => {
      await useGesture(tx, s, "passkey-single", "");
      await tx.update("member", { id: s.memberId }, { singlePasskeyAt: now() });
      return { entry: await append(tx, { who: human(s), what: "passkey-single-chosen", object: s.memberId, requestId }) };
    });
  }

  async function passkeyRemove(s, id, { requestId }) {
    return store.tx(s.tenantId, async (tx) => {
      await useGesture(tx, s, "passkey-remove", id);
      const pks = await tx.list("passkey", { memberId: s.memberId });
      checkRemovable(pks, id);
      await tx.update("passkey", { id }, { removedAt: now() });
      let closedCurrent = false;
      for (const x of await tx.list("session", { passkeyId: id })) if (!x.closedAt) { await tx.update("session", { id: x.id }, { closedAt: now() }); if (x.id === s.id) closedCurrent = true; }
      await security(tx, { what: "passkey-removed", member: s.memberId, passkey: id });
      const e = await append(tx, { who: human(s), what: "passkey-removed", object: id, requestId, detail: { closedCurrent } });
      return { entry: e, closedCurrent, restorableUntil: iso(now() + PASSKEY_RESTORE_WINDOW) };
    });
  }

  async function passkeyRestore(s, id, { requestId }) {
    return store.tx(s.tenantId, async (tx) => {
      const cur = await useFresh(tx, s);
      const p = await tx.get("passkey", { id });
      if (!p || p.memberId !== s.memberId) throw new Refusal("not-found");
      checkRestorable(p, now(), { freshBy: cur.freshBy });
      await tx.update("passkey", { id }, { removedAt: null });
      await security(tx, { what: "passkey-restored", member: s.memberId, passkey: id });
      return { entry: await append(tx, { who: human(s), what: "passkey-restored", object: id, requestId }) };
    });
  }

  async function sessionClose(s, id, { requestId }) {
    return store.tx(s.tenantId, async (tx) => {
      await useFresh(tx, s);
      const x = await tx.get("session", { id });
      if (!x || x.memberId !== s.memberId || x.closedAt) throw new Refusal("not-found");
      await tx.update("session", { id }, { closedAt: now() });
      await security(tx, { what: "session-closed", member: s.memberId, session: id });
      return { entry: await append(tx, { who: human(s), what: "session-closed", object: id, requestId }), closedCurrent: id === s.id };
    });
  }

  async function sessionsCloseOthers(s, { requestId }) {
    return store.tx(s.tenantId, async (tx) => {
      await useFresh(tx, s);
      let n = 0;
      for (const x of await tx.list("session", { memberId: s.memberId })) if (!x.closedAt && x.id !== s.id) { await tx.update("session", { id: x.id }, { closedAt: now() }); n++; }
      await security(tx, { what: "sessions-closed-others", member: s.memberId, count: n });
      return { closed: n, entry: await append(tx, { who: human(s), what: "sessions-closed-others", object: s.id, requestId, detail: { closed: n } }) };
    });
  }

  async function recoveryCancel(s, { requestId }) {
    return store.tx(s.tenantId, async (tx) => {
      const r = (await tx.list("link", { kind: "recovery" })).find((l) => !l.usedAt && !l.cancelledAt && now() < l.expiresAt);
      if (!r) throw new Refusal("not-found");
      await useGesture(tx, s, "recovery-cancel", r.id);
      await tx.update("link", { id: r.id }, { cancelledAt: now() });
      await security(tx, { what: "recovery-cancelled", link: r.id });
      return { entry: await append(tx, { who: human(s), what: "recovery-cancelled", object: r.id, requestId }) };
    });
  }

  return {
    sessionFrom, signInOptions, signIn, signOut, freshOptions, fresh, useGesture, useFresh,
    inspectLink, linkOptions, redeemLink, sessionView, accessView,
    passkeyAddOptions, passkeyAdd, passkeySingle, passkeyRemove, passkeyRestore, sessionClose, sessionsCloseOthers, recoveryCancel,
  };
}
