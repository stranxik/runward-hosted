// After a restore of the database (T24, PADR-0014 note): `restoreReplay` puts the accesses back where the
// security log of the object store says they were. Each test makes a backup of the in-memory store at an
// instant T, lets gestures happen after T, replaces the store's state by the backup (the object store keeps
// everything, as it does in production), runs the gesture, and reads the accesses as a person meets them.
// The same scenario runs on a real PostgreSQL, under rw_maint, in test/pg/restore-replay.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { harness, founder, gesture, sha } from "../helpers.js";
import { verifyChain } from "../../src/domain/ledger.js";
import { ulid } from "../../src/adapters/system/ulid.js";

const refusal = async (p) => { try { await p; return null; } catch (e) { return e.code ?? e.message; } };
const tok = () => randomBytes(32).toString("base64url");
const tick = (h) => h.clock.advance(1000);

/** T: what the database holds, and the ULID every gesture written from T on sorts after (runbook §16 step 7). */
function backup(h) {
  tick(h);
  const s = h.store._state;
  const since = ulid(h.clock.now()).slice(0, 10) + "0".repeat(16);
  tick(h);
  return { since, rows: { ...s.rows }, ledger: s.ledger, operator: [...s.operator] };
}
/** The loss: the database is replaced by the backup. The object store is untouched. */
function restore(h, b) {
  const s = h.store._state;
  s.rows = { ...b.rows }; s.ledger = b.ledger; s.operator = [...b.operator];
}

async function signIn(h, cred) {
  const o = await h.app.identity.signInOptions();
  return h.app.identity.signIn({ challengeId: o.challengeId, response: { id: cred, challenge: o.options.challenge } });
}
const rows = (h, tenant, table, where = {}) => h.store.tx(tenant, (tx) => tx.list(table, where));
const passkey = async (h, tenant, cred) => (await rows(h, tenant, "passkey")).find((p) => p.credentialId === cred);
const journal = (h, tenant) => h.store.tx(tenant, (tx) => tx.ledgerAll());
const notes = (h, what) => h.store._state.operator.filter((n) => n.what === what);
const openSessions = async (h, tenant) => (await rows(h, tenant, "session")).filter((s) => !s.closedAt).length;

/** A gesture of the Access screen, with its verification, one second after the previous one. */
async function removePasskey(h, f, cred) {
  tick(h);
  const p = await passkey(h, f.tenant, cred);
  await gesture(h, f.session, "passkey-remove", p.id);
  await h.app.identity.passkeyRemove(f.session, p.id, {});
  return p.id;
}
async function restorePasskey(h, f, cred) {
  tick(h);
  const p = await passkey(h, f.tenant, cred);
  await gesture(h, f.session, null, null);
  await h.app.identity.passkeyRestore(f.session, p.id, {});
}

test("T24: the gestures after the backup are replayed in ULID order, every session is closed, the journal says so", async () => {
  const h = harness();
  const a = await founder(h, { passkeys: 3, prefix: "a" });
  const second = await signIn(h, "a-2");
  await gesture(h, a.session, "declare-with-consent", "drill/alpha");
  const repo = await h.app.repositories.declare(a.session, { name: "drill/alpha", consent: true }, {});
  const rec = await h.app.operator.openRecovery({ hash: sha(Buffer.from(tok())), tenant: a.tenant, member: a.session.memberId });
  const b = await backup(h);

  // after T: a-2 removed (its session closes with it) then restored, a-3 removed for good, the consent
  // withdrawn, the repository removed, the recovery cancelled, a third session opened
  await removePasskey(h, a, "a-2");
  await restorePasskey(h, a, "a-2");
  await removePasskey(h, a, "a-3");
  tick(h);
  await gesture(h, a.session, "consent-withdraw", repo.id);
  await h.app.repositories.withdrawConsent(a.session, repo.id, {});
  tick(h);
  await gesture(h, a.session, null, null);
  await h.app.repositories.remove(a.session, repo.id, {});
  tick(h);
  await gesture(h, a.session, "recovery-cancel", rec.link);
  await h.app.identity.recoveryCancel(a.session, {});
  tick(h);
  const third = await signIn(h, "a-1");
  assert.equal(await h.app.identity.sessionFrom(second.token), null, "before the loss: the session of a-2 was closed with it");
  assert.equal(await refusal(signIn(h, "a-3")), "passkey-unknown", "before the loss: a-3 opens nothing");

  restore(h, b);
  // the control: the restore alone resurrects what was withdrawn after T
  assert.ok(await h.app.identity.sessionFrom(second.token), "the restore gave the closed session back");
  assert.equal((await passkey(h, a.tenant, "a-3")).removedAt, null, "the restore gave the removed passkey back");
  assert.equal(await h.app.identity.sessionFrom(third.token), null, "a session opened after T is not in the backup");

  const report = await h.app.operator.restoreReplay({ since: b.since });
  assert.equal(report.length, 1);
  assert.equal(report[0].tenant, a.tenant);
  assert.equal(report[0].closed, 2, "the two sessions the backup held");
  assert.equal(report[0].replayed, 6, "two removals, one restoration, the consent, the repository, the recovery");

  assert.equal(await openSessions(h, a.tenant), 0);
  assert.equal(await h.app.identity.sessionFrom(a.token), null, "a session of before the loss opens nothing");
  assert.equal((await passkey(h, a.tenant, "a-2")).removedAt, null, "removed then restored: replayed the other way round it would end removed");
  assert.ok((await passkey(h, a.tenant, "a-3")).removedAt, "removed for good");
  assert.equal(await refusal(signIn(h, "a-3")), "passkey-unknown", "the passkey withdrawn after T opens nothing");
  assert.ok((await signIn(h, "a-2")).token, "the passkey removed then restored signs in");
  const [r] = await rows(h, a.tenant, "repository");
  assert.equal(r.consent, false, "the consent is withdrawn again");
  assert.ok(r.removedAt, "the repository is removed again");
  assert.ok((await rows(h, a.tenant, "forge_repository"))[0].removedAt);
  assert.ok((await rows(h, a.tenant, "link", { id: rec.link }))[0].cancelledAt, "the recovery is cancelled again");

  const entries = await journal(h, a.tenant);
  const note = entries.find((e) => e.body.what === "restore-replayed");
  assert.deepEqual(note.body.who, { type: "operator", id: "operateur" });
  assert.equal(note.body.detail.since, b.since);
  assert.equal(note.body.detail.closed, 2);
  assert.equal(note.body.detail.replayed, 6);
  assert.equal(verifyChain(entries).ok, true, "the chain holds from its first entry to the note and after");
  const [op] = notes(h, "restore-replayed");
  assert.equal(op.detail.since, b.since);
  assert.equal(op.detail.report.length, 1);
});

test("T24: a gesture on something the restore lost is not replayed, and each tenant is replayed from its own log", async () => {
  const h = harness();
  const a = await founder(h, { passkeys: 2, prefix: "a" });
  const bt = await founder(h, { passkeys: 2, prefix: "b" });
  const b = await backup(h);
  // after T, in A: a third passkey added then removed (neither is in the backup); in B: b-2 removed
  tick(h);
  await gesture(h, a.session, "passkey-add", "");
  const ao = await h.app.identity.passkeyAddOptions(a.session);
  await h.app.identity.passkeyAdd(a.session, { challengeId: ao.challengeId, response: { id: "a-3", challenge: ao.options.challenge } });
  await removePasskey(h, a, "a-3");
  await removePasskey(h, bt, "b-2");
  restore(h, b);

  const report = await h.app.operator.restoreReplay({ since: b.since });
  const ra = report.find((r) => r.tenant === a.tenant), rb = report.find((r) => r.tenant === bt.tenant);
  assert.deepEqual({ closed: ra.closed, replayed: ra.replayed }, { closed: 1, replayed: 0 }, "the passkey added after T is gone with the restore: nothing to replay");
  assert.deepEqual({ closed: rb.closed, replayed: rb.replayed }, { closed: 1, replayed: 1 });
  assert.equal((await rows(h, a.tenant, "passkey")).filter((p) => !p.removedAt).length, 2, "A keeps its two passkeys");
  assert.ok((await passkey(h, bt.tenant, "b-2")).removedAt, "B's removal is replayed in B");
  assert.equal(await refusal(signIn(h, "b-2")), "passkey-unknown");
  for (const t of [a.tenant, bt.tenant]) assert.equal((await journal(h, t)).filter((e) => e.body.what === "restore-replayed").length, 1, "one note per tenant");
});
