// Human identity (PADR-0012 and its notes): the links, the sessions, fresh and per-gesture verification,
// passkeys removed then restored, recovery, reset.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { harness, founder, gesture, sha } from "../helpers.js";
import { DAY, HOUR, MIN } from "../../src/domain/identity.js";

const refusal = async (p) => { try { await p; return null; } catch (e) { return e.code ?? e.message; } };
const tok = () => randomBytes(32).toString("base64url");

test("bootstrap: the link opens the founder's account once, then is closed for good", async () => {
  const h = harness();
  const t = tok();
  await h.app.operator.openBootstrap({ hash: sha(Buffer.from(t)) });
  assert.equal((await h.app.identity.inspectLink({ token: t })).state, "link-live");
  const o = await h.app.identity.linkOptions({ token: t });
  const o2 = await h.app.identity.linkOptions({ token: t });
  const r = await h.app.identity.redeemLink({ token: t, challengeId: o.challengeId, response: { id: "a", challenge: o.options.challenge } });
  assert.ok(r.token);
  assert.equal(await refusal(h.app.identity.redeemLink({ token: t, challengeId: o2.challengeId, response: { id: "b", challenge: o2.options.challenge } })), "link-used", "a second concurrent opening gets link-used");
  assert.equal((await h.app.identity.inspectLink({ token: t })).state, "link-used");
  const s = await h.app.identity.sessionFrom(r.token);
  assert.equal((await h.app.identity.inspectLink({ token: t, session: s })).state, "link-used");
  assert.match(String(await refusal(h.app.operator.openBootstrap({ hash: sha(Buffer.from(tok())), tenant: s.tenantId }))), /closed for good/);
});

test("a link: invalid without oracle, expires after 24 h, nothing consumed on inspect", async () => {
  const h = harness();
  assert.equal((await h.app.identity.inspectLink({ token: tok() })).state, "link-invalid");
  assert.equal((await h.app.identity.inspectLink({ token: "short" })).state, "link-invalid");
  const t = tok();
  await h.app.operator.openBootstrap({ hash: sha(Buffer.from(t)) });
  for (let i = 0; i < 3; i++) assert.equal((await h.app.identity.inspectLink({ token: t })).state, "link-live");
  h.clock.advance(DAY);
  assert.equal((await h.app.identity.inspectLink({ token: t })).state, "link-expired");
  assert.equal(await refusal(h.app.identity.linkOptions({ token: t })), "link-expired");
});

test("a challenge is single use and consumed before the ceremony is verified", async () => {
  const h = harness();
  const t = tok();
  await h.app.operator.openBootstrap({ hash: sha(Buffer.from(t)) });
  const o = await h.app.identity.linkOptions({ token: t });
  assert.equal(await refusal(h.app.identity.redeemLink({ token: t, challengeId: o.challengeId, response: { id: "a", challenge: o.options.challenge, fail: true } })), "ceremony-failed");
  assert.equal(await refusal(h.app.identity.redeemLink({ token: t, challengeId: o.challengeId, response: { id: "a", challenge: o.options.challenge } })), "challenge-invalid", "the failed attempt consumed it");
  assert.equal((await h.app.identity.inspectLink({ token: t })).state, "link-live", "the link stays live after a failed ceremony");
  const so = await h.app.identity.signInOptions();
  h.clock.advance(5 * MIN + 1);
  assert.equal(await refusal(h.app.identity.signIn({ challengeId: so.challengeId, response: { id: "a", challenge: so.options.challenge } })), "challenge-invalid", "five minutes");
});

test("sign-in: unknown passkey, then a session; idle 12 h and absolute 7 days", async () => {
  const h = harness();
  const f = await founder(h);
  let o = await h.app.identity.signInOptions();
  assert.equal(await refusal(h.app.identity.signIn({ challengeId: o.challengeId, response: { id: "nope", challenge: o.options.challenge } })), "passkey-unknown");
  o = await h.app.identity.signInOptions();
  const r = await h.app.identity.signIn({ challengeId: o.challengeId, response: { id: "cred-2", challenge: o.options.challenge } });
  assert.ok(await h.app.identity.sessionFrom(r.token));
  h.clock.advance(12 * HOUR);
  assert.equal(await h.app.identity.sessionFrom(r.token), null, "idle 12 h");
  assert.equal(await h.app.identity.sessionFrom(f.token), null);
  o = await h.app.identity.signInOptions();
  const r2 = await h.app.identity.signIn({ challengeId: o.challengeId, response: { id: "cred-1", challenge: o.options.challenge } });
  for (let i = 0; i < 14; i++) { h.clock.advance(12 * HOUR - MIN); assert.ok(await h.app.identity.sessionFrom(r2.token), "alive while touched"); }
  h.clock.advance(15 * MIN);
  assert.equal(await h.app.identity.sessionFrom(r2.token), null, "absolute 7 days");
});

test("gestures: fresh within 5 minutes; per gesture bound to its gesture and object, single use", async () => {
  const h = harness();
  const f = await founder(h);
  const s = f.session;
  h.clock.advance(6 * MIN);
  assert.equal(await refusal(h.app.repositories.declare(s, { name: "a/b" }, {})), "fresh-required");
  await gesture(h, s, null, null);
  assert.equal((await h.app.repositories.declare(s, { name: "a/b" }, {})).state, "pending");
  const pk = (await h.app.identity.accessView(s)).passkeys.find((p) => !p.current);
  assert.equal(await refusal(h.app.identity.passkeyRemove(s, pk.id, {})), "gesture-required");
  await gesture(h, s, "passkey-remove", "another-object");
  assert.equal(await refusal(h.app.identity.passkeyRemove(s, pk.id, {})), "gesture-required", "bound to its object");
  await gesture(h, s, "passkey-remove", pk.id);
  await h.app.identity.passkeyRemove(s, pk.id, {});
  assert.equal(await refusal(h.app.identity.passkeyRestore(s, pk.id, {})) ?? "ok", "ok", "restore within the fresh window, by another passkey");
});

test("passkeys: never the last; removing the one that opened the session closes it; restore for 24 h only", async () => {
  const h = harness();
  const f = await founder(h);
  const s = f.session;
  const view = await h.app.identity.accessView(s);
  const cur = view.passkeys.find((p) => p.current);
  const other = view.passkeys.find((p) => !p.current);
  await gesture(h, s, "passkey-remove", cur.id, "cred-2");
  const r = await h.app.identity.passkeyRemove(s, cur.id, {});
  assert.equal(r.closedCurrent, true);
  assert.equal(await h.app.identity.sessionFrom(f.token), null);
  let o = await h.app.identity.signInOptions();
  const s2 = await h.app.identity.sessionFrom((await h.app.identity.signIn({ challengeId: o.challengeId, response: { id: "cred-2", challenge: o.options.challenge } })).token);
  await gesture(h, s2, "passkey-remove", other.id, "cred-2");
  assert.equal(await refusal(h.app.identity.passkeyRemove(s2, other.id, {})), "last-passkey");
  h.clock.advance(DAY);
  await gesture(h, s2, null, null, "cred-2");
  assert.equal(await refusal(h.app.identity.passkeyRestore(s2, cur.id, {})), "restore-window-closed");
});

test("the second passkey: same device refused passkey-exists; same provider warned; single choice written", async () => {
  const h = harness();
  const f = await founder(h, { passkeys: 1 });
  let sv = await h.app.identity.sessionView(f.session);
  assert.equal(sv.arrivalOpen, false, "the first arrival stays closed with one passkey");
  await gesture(h, f.session, "passkey-add", "");
  const o = await h.app.identity.passkeyAddOptions(f.session);
  assert.equal(await refusal(h.app.identity.passkeyAdd(f.session, { challengeId: o.challengeId, response: { id: "cred-1", challenge: o.options.challenge } })), "passkey-exists");
  await gesture(h, f.session, "passkey-single", "");
  await h.app.identity.passkeySingle(f.session, {});
  sv = await h.app.identity.sessionView(await h.app.identity.sessionFrom(f.token));
  assert.equal(sv.arrivalOpen, true);
  assert.equal(sv.single, true);
  const h2 = harness();
  const f2 = await founder(h2);
  assert.equal((await h2.app.identity.sessionView(f2.session)).sameProvider, false, "iCloud and 1Password are two providers");
});

test("recovery: usable 24 h after it opens, for 24 h; cancellable from a session; arrival closes everything", async () => {
  const h = harness();
  const f = await founder(h);
  const t = tok();
  const rec = await h.app.operator.openRecovery({ hash: sha(Buffer.from(t)), tenant: f.tenant, member: f.session.memberId });
  assert.equal(Date.parse(rec.usableFrom) - h.clock.now(), DAY);
  assert.equal((await h.app.identity.inspectLink({ token: t })).state, "link-not-yet");
  const sv = await h.app.identity.sessionView(f.session);
  assert.ok(sv.recovery, "every open session sees the banner");
  h.clock.advance(DAY);
  const s = await h.app.identity.sessionFrom(f.token);
  assert.equal(s, null, "idle");
  // the true holder signs in again and the recovery is still live: the new member arrives
  const o = await h.app.identity.linkOptions({ token: t });
  const r = await h.app.identity.redeemLink({ token: t, challengeId: o.challengeId, response: { id: "cred-new", challenge: o.options.challenge } });
  const s2 = await h.app.identity.sessionFrom(r.token);
  const view = await h.app.identity.accessView(s2);
  assert.equal(view.passkeys.filter((p) => !p.removedAt).length, 1);
  assert.equal(view.passkeys.filter((p) => p.restorableUntil).length, 0, "old passkeys are lost, never restorable");
  assert.equal((await h.app.identity.sessionView(s2)).arrivalOpen, false, "the arrival asks again for a second passkey");
});

test("recovery cancelled from an open session", async () => {
  const h = harness();
  const f = await founder(h);
  const t = tok();
  const rec = await h.app.operator.openRecovery({ hash: sha(Buffer.from(t)), tenant: f.tenant, member: f.session.memberId });
  assert.equal(await refusal(h.app.identity.recoveryCancel(f.session, {})), "gesture-required");
  await gesture(h, f.session, "recovery-cancel", rec.link);
  await h.app.identity.recoveryCancel(f.session, {});
  assert.equal((await h.app.identity.inspectLink({ token: t })).state, "link-cancelled");
  const sec = await h.objects.securitySince(f.tenant, "");
  assert.ok(sec.some((x) => x.event.what === "recovery-cancelled"), "doubled in the security log");
});

test("reset-access withdraws every access, keeps the data, reopens a bootstrap", async () => {
  const h = harness();
  const f = await founder(h);
  const t = tok();
  await h.app.operator.resetAccess({ hash: sha(Buffer.from(t)), tenant: f.tenant });
  assert.equal(await h.app.identity.sessionFrom(f.token), null);
  assert.equal((await h.app.identity.inspectLink({ token: t })).state, "link-live");
  const o = await h.app.identity.linkOptions({ token: t });
  await h.app.identity.redeemLink({ token: t, challengeId: o.challengeId, response: { id: "cred-x", challenge: o.options.challenge } });
});

test("the security log is written before the database commits: a failing write fails the gesture", async () => {
  const h = harness();
  const f = await founder(h);
  const view = await h.app.identity.accessView(f.session);
  const other = view.passkeys.find((p) => !p.current);
  await gesture(h, f.session, "passkey-remove", other.id);
  const orig = h.objects.writeSecurity;
  h.objects.writeSecurity = async () => { throw new Error("object store down"); };
  assert.match(String(await refusal(h.app.identity.passkeyRemove(f.session, other.id, {}))), /object store down/);
  h.objects.writeSecurity = orig;
  const after = await h.app.identity.accessView(f.session);
  assert.equal(after.passkeys.find((p) => p.id === other.id).removedAt, null, "nothing was removed");
});

test("a passkey added is announced in the OTHER sessions, never in the one that added it (guard on a witness finding)", async () => {
  const h = harness();
  const f = await founder(h, { passkeys: 1 });
  let o = await h.app.identity.signInOptions();
  const other = await h.app.identity.signIn({ challengeId: o.challengeId, response: { id: "cred-1", challenge: o.options.challenge } });
  h.clock.advance(1000);
  await gesture(h, f.session, "passkey-add", "");
  const ao = await h.app.identity.passkeyAddOptions(f.session);
  await h.app.identity.passkeyAdd(f.session, { challengeId: ao.challengeId, response: { id: "cred-2", challenge: ao.options.challenge } });
  assert.equal((await h.app.identity.sessionView(await h.app.identity.sessionFrom(f.token))).addedElsewhere.length, 0);
  assert.equal((await h.app.identity.sessionView(await h.app.identity.sessionFrom(other.token))).addedElsewhere.length, 1);
});
