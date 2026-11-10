// After a restore of the database (T24, PADR-0014 note): `restoreReplay` puts the accesses back where the
// security log of the object store says they were. Each test makes a backup of the in-memory store at an
// instant T, lets gestures happen after T, replaces the store's state by the backup (the object store keeps
// everything, as it does in production), runs the gesture, and reads the accesses as a person meets them.
// The same scenario runs on a real PostgreSQL, under rw_maint, in test/pg/restore-replay.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { harness, founder, gesture, pinnedRepository, send, sha } from "../helpers.js";
import { verifyChain } from "../../src/domain/ledger.js";
import { ulid } from "../../src/adapters/system/ulid.js";
import { DAY } from "../../src/domain/identity.js";
import { SECURITY_REPLAYED, SECURITY_NOT_REPLAYED } from "../../src/application/operator.js";

const refusal = async (p) => { try { await p; return null; } catch (e) { return e.code ?? e.message; } };
const tok = () => randomBytes(32).toString("base64url");
const tick = (h) => h.clock.advance(1000);

/** The ULID every gesture written from now on sorts after (runbook §16 step 7). */
function mark(h) {
  tick(h);
  const since = ulid(h.clock.now()).slice(0, 10) + "0".repeat(16);
  tick(h);
  return since;
}
/** What the database holds now. */
function snapshot(h) {
  const s = h.store._state;
  return { rows: { ...s.rows }, ledger: s.ledger, operator: [...s.operator] };
}
/** T: the backup, and the ULID of its instant. */
const backup = (h) => ({ since: mark(h), ...snapshot(h) });
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
  const b = backup(h);

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
  const b = backup(h);
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

// ---------------------------------------------------------------- defect 1: what the replay did not read

test("T24: an access reset after the backup is replayed: the withdrawn passkey opens nothing, the tenant waits for its bootstrap", async () => {
  const h = harness();
  const a = await founder(h, { passkeys: 2, prefix: "a" });
  const c = await founder(h, { passkeys: 1, prefix: "c" });
  const b = backup(h);
  // after T: the operator resets C's access (the intruder who won the bootstrap)
  await h.app.operator.resetAccess({ hash: sha(Buffer.from(tok())), tenant: c.tenant });
  assert.equal(await refusal(signIn(h, "c-1")), "passkey-unknown", "before the loss: the reset withdrew the passkey");
  restore(h, b);
  assert.equal((await passkey(h, c.tenant, "c-1")).removedAt, null, "the control: the restore gave the passkey back");

  const report = await h.app.operator.restoreReplay({ since: b.since });
  const rc = report.find((r) => r.tenant === c.tenant), ra = report.find((r) => r.tenant === a.tenant);
  assert.equal(await refusal(signIn(h, "c-1")), "passkey-unknown", "the passkey the reset withdrew after the backup must open no session");
  assert.deepEqual({ closed: rc.closed, replayed: rc.replayed, memberless: rc.memberless }, { closed: 1, replayed: 1, memberless: true });
  assert.equal(ra.memberless, false);
  assert.equal((await rows(h, c.tenant, "member")).filter((m) => !m.removedAt).length, 0, "no member left");
  const pk = await passkey(h, c.tenant, "c-1");
  assert.ok(pk.removedAt && pk.lost, "the passkey is lost, never restorable");
  assert.ok((await signIn(h, "a-1")).token, "the other tenant is untouched");
  // the bootstrap the reset opened is gone with the restore: the operator opens one again, a founder arrives
  const t = tok();
  await h.app.operator.openBootstrap({ hash: sha(Buffer.from(t)), tenant: c.tenant });
  const again = await founder(h, { passkeys: 1, prefix: "c2", token: t, tenant: c.tenant });
  assert.ok(again.session, "the tenant is opened again by its rightful founder");
});

test("T24: a reset inside the backup's margin is replayed without withdrawing the founder who arrived after it", async () => {
  const h = harness();
  const c = await founder(h, { passkeys: 1, prefix: "c" });
  const stale = await h.app.operator.openRecovery({ hash: sha(Buffer.from(tok())), tenant: c.tenant, member: c.session.memberId });
  // `since` is taken with a margin: the reset and the new founder are both in the backup AND in the replay
  const since = mark(h);
  const t = tok();
  const reset = await h.app.operator.resetAccess({ hash: sha(Buffer.from(t)), tenant: c.tenant });
  tick(h);
  const next = await founder(h, { passkeys: 2, prefix: "n", token: t, tenant: c.tenant });
  tick(h);
  const b = snapshot(h);
  await removePasskey(h, next, "n-2");
  restore(h, b);

  const [r] = await h.app.operator.restoreReplay({ since });
  assert.equal(r.memberless, false, "the founder who arrived after the reset is still the tenant's member");
  assert.deepEqual(r.stranded, []);
  assert.ok((await signIn(h, "n-1")).token, "and signs in");
  assert.equal(await refusal(signIn(h, "n-2")), "passkey-unknown", "the removal after the backup is replayed");
  assert.equal(await refusal(signIn(h, "c-1")), "passkey-unknown", "the access of before the reset stays withdrawn");
  const links = await rows(h, c.tenant, "link");
  assert.ok(links.find((l) => l.id === stale.link).cancelledAt, "the recovery of before the reset stays cancelled");
  assert.ok(links.find((l) => l.id === reset.link).usedAt, "the bootstrap the reset opened was redeemed, not cancelled");
});

test("T24: a recovery redeemed after the backup is replayed: the passkeys it replaced open nothing, its link is used", async () => {
  const h = harness();
  const f = await founder(h, { passkeys: 2 });
  const t = tok();
  await h.app.operator.openRecovery({ hash: sha(Buffer.from(t)), tenant: f.tenant, member: f.session.memberId });
  h.clock.advance(DAY);
  const b = backup(h);
  // after T: the member arrives by the recovery; the two passkeys of before are lost
  const o = await h.app.identity.linkOptions({ token: t });
  await h.app.identity.redeemLink({ token: t, challengeId: o.challengeId, response: { id: "cred-new", challenge: o.options.challenge } });
  assert.equal(await refusal(signIn(h, "cred-1")), "passkey-unknown", "before the loss: the recovery withdrew the old passkey");
  restore(h, b);
  assert.equal((await passkey(h, f.tenant, "cred-1")).removedAt, null, "the control: the restore gave the lost passkey back");
  assert.equal((await h.app.identity.inspectLink({ token: t })).state, "link-live", "the control: and the redeemed link");

  const [r] = await h.app.operator.restoreReplay({ since: b.since });
  for (const cred of ["cred-1", "cred-2"]) {
    assert.equal(await refusal(signIn(h, cred)), "passkey-unknown", `${cred}, replaced by the recovery after the backup, must open no session`);
    const p = await passkey(h, f.tenant, cred);
    assert.ok(p.removedAt && p.lost, "lost, never restorable");
  }
  assert.equal(r.replayed, 1);
  assert.deepEqual(r.stranded, [f.session.memberId], "the passkey the recovery registered is gone with the restore: the member is stranded");
  assert.equal((await h.app.identity.inspectLink({ token: t })).state, "link-used", "the redeemed link is single use");
});

test("T24: a bootstrap redeemed after the backup does not open the tenant a second time", async () => {
  const h = harness();
  const t = tok();
  const { tenant } = await h.app.operator.openBootstrap({ hash: sha(Buffer.from(t)) });
  const b = backup(h);
  await founder(h, { passkeys: 1, token: t, tenant });
  restore(h, b);
  assert.equal((await h.app.identity.inspectLink({ token: t })).state, "link-live", "the control: the restore gave the redeemed link back");

  const [r] = await h.app.operator.restoreReplay({ since: b.since });
  assert.equal(r.memberless, true, "the founder is gone with the restore: the operator opens a bootstrap again");
  assert.equal((await h.app.identity.inspectLink({ token: t })).state, "link-used");
  assert.equal(await refusal(h.app.identity.linkOptions({ token: t })), "link-used");
});

test("T24: content erased after the backup is erased again: the uploads are out of the next assembly, which no longer fails", async () => {
  const h = harness();
  const f = await founder(h);
  const repo = await pinnedRepository(h, f);
  const b = backup(h);
  await gesture(h, f.session, "content-erase", repo.id);
  await h.app.repositories.eraseContent(f.session, repo.id, {});
  tick(h);
  const bytes = () => [...h.objects._map.keys()].filter((k) => k.includes("/sha256/")).length;
  assert.equal(bytes(), 0, "before the loss: the bytes left the object store");
  restore(h, b);
  // the control: the restored database still counts bytes the object store no longer has
  assert.equal((await rows(h, f.tenant, "upload")).filter((u) => !u.erasedAt).length, 1);
  await gesture(h, f.session, null, null);
  assert.equal(await refusal(h.app.repositories.settings(f.session, { lang: "en" }, {})), "service-unavailable", "the control: the next assembly fails on them");

  const [r] = await h.app.operator.restoreReplay({ since: b.since });
  const ups = await rows(h, f.tenant, "upload");
  assert.equal(ups.filter((u) => !u.erasedAt).length, 0, "the uploads erased after the backup must be erased again");
  assert.equal(r.replayed, 1);
  const [blob] = await rows(h, f.tenant, "blob");
  assert.deepEqual({ refs: blob.refs, erased: Boolean(blob.erasedAt) }, { refs: 0, erased: true });
  const sent = await send(h, { run_number: "6", run_id: "40000000006" });
  assert.equal(sent.status, 201, "the next upload is accepted and the index is assembled without the erased content");
  assert.equal(bytes(), 1, "only the new upload's bytes are kept");
  // replayed a second time (the margin of the backup's instant), the erasure touches nothing: the new upload stays
  await h.app.operator.restoreReplay({ since: b.since });
  assert.equal((await rows(h, f.tenant, "upload")).filter((u) => !u.erasedAt).length, 1);
  assert.equal(bytes(), 1);
});

test("every kind the security log receives is replayed, or left with its reason (the class of defect 1)", () => {
  const dir = new URL("../../src/application/", import.meta.url);
  const kinds = new Set();
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    const text = readFileSync(new URL(name, dir), "utf8");
    const calls = [...text.matchAll(/(?<!function )\bsecurity\(tx, (?:\{ what(?:: "([a-z-]+)")?)?/g)];
    for (const m of calls) {
      assert.ok(m[0].includes("{ what"), `${name}: a call of security() whose kind this test cannot read: ${m[0]}`);
      if (m[1]) kinds.add(m[1]);
      // `{ what, … }`: the kind is a variable, assigned from literals in the same file
      else for (const v of text.matchAll(/\bwhat = "([a-z-]+)"/g)) kinds.add(v[1]);
    }
  }
  assert.ok(kinds.has("access-reset") && kinds.has("member-recovered") && kinds.has("content-erased") && kinds.size >= 14, `the scan reads the kinds (${kinds.size})`);
  const decided = [...SECURITY_REPLAYED, ...Object.keys(SECURITY_NOT_REPLAYED)];
  assert.equal(new Set(decided).size, decided.length, "a kind is replayed or left, never both");
  assert.deepEqual([...kinds].filter((k) => !decided.includes(k)).sort(), [], "a kind the security log receives and the replay neither applies nor leaves with a reason");
  assert.deepEqual(decided.filter((k) => !kinds.has(k)).sort(), [], "a kind the replay names and nothing writes");
});

// ---------------------------------------------------------------- defect 6: a security log that cannot be read

/** Makes one object of a tenant's security log listed and unreadable, as a bucket that lists a key and answers 404 on it. */
function unreadable(h, tenant) {
  const m = h.objects._map;
  const key = [...m.keys()].filter((k) => k.startsWith(`tenants/${tenant}/security/`)).sort().pop();
  m.has = (k) => k !== key && Map.prototype.has.call(m, k);
  return key.slice(-31, -5);
}

test("the security log: an object that is listed and cannot be read, or is not an event, is refused with a code", async () => {
  const h = harness();
  const f = await founder(h);
  assert.equal((await h.objects.securitySince(f.tenant, "")).length, 2, "the control: the log reads");
  const id = unreadable(h, f.tenant);
  const e = await h.objects.securitySince(f.tenant, "").then(() => null, (x) => x);
  assert.equal(e?.code, "security-log-unreadable", `a refusal with its code, not ${e?.constructor.name}: ${e?.message}`);
  assert.match(e.message, new RegExp(`^security-log-unreadable: object ${id} is listed and cannot be read$`));
  assert.ok(!e.message.includes(f.tenant), "the message names the object, never the tenant");
  const h2 = harness();
  const f2 = await founder(h2);
  h2.objects._map.set(`tenants/${f2.tenant}/security/${ulid(h2.clock.now())}.json`, Buffer.from("<Error>NoSuchBucket</Error>"));
  assert.equal(await refusal(h2.objects.securitySince(f2.tenant, "")), "security-log-unreadable");
});

test("restore-replay is refused whole when one tenant's log cannot be read: nothing is written, the refusal is noted", async () => {
  const h = harness();
  const a = await founder(h, { prefix: "a" });
  const bt = await founder(h, { prefix: "b" });
  const b = backup(h);
  await removePasskey(h, a, "a-2");
  await removePasskey(h, bt, "b-2");
  restore(h, b);
  unreadable(h, bt.tenant);
  const before = { ledger: h.store._state.ledger.length, sessions: [await openSessions(h, a.tenant), await openSessions(h, bt.tenant)] };

  const e = await h.app.operator.restoreReplay({ since: b.since }).then(() => null, (x) => x);
  assert.deepEqual({ ledger: h.store._state.ledger.length, sessions: [await openSessions(h, a.tenant), await openSessions(h, bt.tenant)] }, before, "no partial write: no session closed, no journal entry, in any tenant");
  assert.equal((await passkey(h, a.tenant, "a-2")).removedAt, null, "no gesture replayed, in the tenant whose log reads either");
  assert.equal(e?.code, "security-log-unreadable", `a refusal with its code, not ${e?.constructor.name}: ${e?.message}`);
  assert.match(e.message, /^security-log-unreadable: the security log of 1 tenant\(s\) out of 2 cannot be read; nothing was replayed/);
  const [note] = notes(h, "restore-replayed");
  assert.deepEqual({ refused: note.detail.refused, failed: note.detail.failed, tenants: note.detail.report.map((r) => r.tenant) }, { refused: "security-log-unreadable", failed: 1, tenants: [bt.tenant] }, "the refusal is in the operator journal, with the tenant it names");
  // the object store answers again: the same gesture replays both tenants
  delete h.objects._map.has;
  const report = await h.app.operator.restoreReplay({ since: b.since });
  assert.deepEqual(report.map((r) => r.replayed), [1, 1]);
});

// ---------------------------------------------------------------- defect 5: one tenant's failure

test("a tenant whose replay fails is rolled back whole and recorded; the next tenants are still replayed; the run is said incomplete", async () => {
  const h = harness({ config: { jobRetryWaits: [0, 0] } });
  const a = await founder(h, { prefix: "a" }), bt = await founder(h, { prefix: "b" }), c = await founder(h, { prefix: "c" });
  const b = backup(h);
  for (const [f, cred] of [[a, "a-2"], [bt, "b-2"], [c, "c-2"]]) await removePasskey(h, f, cred);
  restore(h, b);
  // B's transaction fails at its end, after every write of the replay, three times
  const real = h.store.tx.bind(h.store);
  let armed = true, attempts = 0;
  h.store.tx = (tenant, fn) => (armed && tenant === bt.tenant ? real(tenant, async (tx) => { await fn(tx); attempts++; throw new Error(`planted failure ${attempts}`); }) : real(tenant, fn));

  const report = await h.app.operator.restoreReplay({ since: b.since }).catch((e) => e);
  armed = false;
  assert.ok(Array.isArray(report), `the gesture reports instead of stopping at the failing tenant: ${report.message}`);
  const of = (f) => report.find((r) => r.tenant === f.tenant);
  assert.deepEqual({ failed: of(bt).failed, attempts: of(bt).attempts, error: of(bt).error }, { failed: true, attempts: 3, error: "planted failure 3" });
  assert.equal(attempts, 3, "bounded: three attempts, no more");
  // B: atomic, nothing of the failed replay is left
  assert.equal(await openSessions(h, bt.tenant), 1, "B's session is still open");
  assert.equal((await passkey(h, bt.tenant, "b-2")).removedAt, null);
  assert.equal((await journal(h, bt.tenant)).filter((e) => e.body.what === "restore-replayed").length, 0);
  // A before it and C after it are replayed
  for (const [f, cred] of [[a, "a-2"], [c, "c-2"]]) {
    assert.deepEqual({ failed: of(f).failed, replayed: of(f).replayed, attempts: of(f).attempts }, { failed: undefined, replayed: 1, attempts: 1 });
    assert.equal(await openSessions(h, f.tenant), 0);
    assert.equal(await refusal(signIn(h, cred)), "passkey-unknown", "the tenant after the failing one is replayed too");
  }
  // traced: the operator journal, and the run's status
  const [note] = notes(h, "restore-replayed");
  assert.deepEqual({ failed: note.detail.failed, rows: note.detail.report.length, since: note.detail.since }, { failed: 1, rows: 3, since: b.since });
  const { jobIncomplete, incompleteReason } = await import("../../src/operator.js");
  assert.equal(jobIncomplete(report), true, "the run ends non-zero");
  assert.match(incompleteReason("restore-replay", report), /restore-replay did not complete: 1 tenant\(s\) failed or broken; first reason: planted failure 3/);
  // run again once the cause is gone: B is replayed, A and C end where they were
  const again = await h.app.operator.restoreReplay({ since: b.since });
  assert.equal(jobIncomplete(again), false);
  assert.equal(await refusal(signIn(h, "b-2")), "passkey-unknown");
  for (const cred of ["a-2", "c-2"]) assert.equal(await refusal(signIn(h, cred)), "passkey-unknown");
  for (const cred of ["a-1", "b-1", "c-1"]) assert.ok((await signIn(h, cred)).token);
});

/** Two tenants, each with a member whose recovery was redeemed after the backup: both stranded after the replay. */
async function twoStranded() {
  const h = harness({ config: { jobRetryWaits: [0, 0] } });
  const fs = [await founder(h, { prefix: "a" }), await founder(h, { prefix: "b" })];
  const tokens = [tok(), tok()];
  for (const [i, f] of fs.entries()) await h.app.operator.openRecovery({ hash: sha(Buffer.from(tokens[i])), tenant: f.tenant, member: f.session.memberId });
  h.clock.advance(DAY);
  const b = backup(h);
  for (const [i, t] of tokens.entries()) {
    tick(h);
    const o = await h.app.identity.linkOptions({ token: t });
    await h.app.identity.redeemLink({ token: t, challengeId: o.challengeId, response: { id: `new-${i}`, challenge: o.options.challenge } });
  }
  restore(h, b);
  return { h, fs, since: b.since };
}

test("a recovery is opened for one stranded member, as open-recovery opens it; it never fails a tenant's replay", async () => {
  const { h, fs, since } = await twoStranded();
  const t = tok();
  const report = await h.app.operator.restoreReplay({ since, recoveryHash: sha(Buffer.from(t)) }).catch((e) => e);
  assert.ok(Array.isArray(report), `one digest for two stranded members must not stop the replay: ${report.message}`);
  assert.deepEqual(report.map((r) => [r.failed, r.stranded]), fs.map((f) => [undefined, [f.session.memberId]]), "both tenants are replayed, each with its stranded member");
  for (const cred of ["a-1", "a-2", "b-1", "b-2"]) assert.equal(await refusal(signIn(h, cred)), "passkey-unknown");
  // one recovery, for the first: in its tenant's journal and security log, usable in 24 h
  assert.ok(report[0].recovery, "the report names the recovery it opened");
  assert.equal(report[1].recovery, undefined, "the second member waits for the operator's open-recovery");
  assert.equal((await h.app.identity.inspectLink({ token: t })).state, "link-not-yet");
  const opened = (await journal(h, fs[0].tenant)).filter((e) => e.body.what === "recovery-opened").pop();
  assert.equal(opened.body.object, report[0].recovery, "the member reads the recovery in the journal, as for any recovery");
  assert.ok((await h.objects.securitySince(fs[0].tenant, since)).some((x) => x.event.what === "recovery-opened" && x.event.link === report[0].recovery));
  assert.equal(notes(h, "restore-replayed")[0].detail.failed, 0);

  // a digest already taken: the recovery fails and is said, the tenants are replayed all the same
  const again = await twoStranded();
  const taken = sha(Buffer.from(tok()));
  await again.h.app.operator.openBootstrap({ hash: taken });
  const r2 = await again.h.app.operator.restoreReplay({ since: again.since, recoveryHash: taken });
  assert.deepEqual(again.fs.map((f) => r2.find((r) => r.tenant === f.tenant && !r.stage)).map((r) => [r.failed, r.replayed]), [[undefined, 1], [undefined, 1]]);
  const bad = r2.find((r) => r.stage === "recovery");
  assert.deepEqual({ failed: bad.failed, tenant: bad.tenant }, { failed: true, tenant: again.fs[0].tenant });
  assert.equal(notes(again.h, "restore-replayed")[0].detail.failed, 1, "the recovery that was not opened is in the operator journal");
});

// ---------------------------------------------------------------- defect 3: each tenant has its own chain

const head = async (h, tenant) => { const e = (await journal(h, tenant)).pop(); return { seq: e.seq, hash: e.hash }; };
const replayNote = async (h, tenant) => (await journal(h, tenant)).filter((e) => e.body.what === "restore-replayed").pop().body.detail;

test("each tenant's note carries the head its own journal had before the loss, anchored by the system: never one head for all", async () => {
  const h = harness();
  const fs = [await founder(h, { passkeys: 3, prefix: "a" }), await founder(h, { passkeys: 2, prefix: "b" }), await founder(h, { passkeys: 1, prefix: "c" })];
  const b = backup(h);
  // after T the three journals grow, each by its own number of entries
  await removePasskey(h, fs[0], "a-2");
  await removePasskey(h, fs[0], "a-3");
  await removePasskey(h, fs[1], "b-2");
  tick(h);
  // before the database is replaced, while it can still be read: the heads are anchored in the object store
  const entries = h.store._state.ledger.length;
  const anchored = await h.app.operator.restoreReplay({ anchor: true });
  const appended = h.store._state.ledger.length - entries;
  const noted = notes(h, "restore-anchored").map((n) => [n.detail.failed, n.detail.report.length]);
  const heads = [];
  for (const f of fs) heads.push(await head(h, f.tenant));
  restore(h, b);
  await h.app.operator.restoreReplay({ since: b.since });

  for (const [i, f] of fs.entries()) {
    const d = await replayNote(h, f.tenant);
    assert.deepEqual({ seq: d.headBefore?.seq, hash: d.headBefore?.hash }, heads[i], `tenant ${i}: its note carries the head of its own journal before the loss`);
  }
  assert.equal(new Set(heads.map((x) => x.hash)).size, 3, "the control: the three heads differ, one head could not be right for the three");
  // the anchor itself: one object per tenant in that tenant's security log, and nothing appended to a journal
  assert.deepEqual(anchored.map((r) => [r.tenant, r.seq, r.failed]), fs.map((f, i) => [f.tenant, heads[i].seq, undefined]));
  assert.equal(appended, 0, "anchoring appended nothing to a journal: an anchor that moved the head would not be the head");
  for (const [i, f] of fs.entries()) {
    const mine = (await h.objects.securitySince(f.tenant, b.since)).filter((x) => x.event.what === "journal-anchored");
    assert.deepEqual(mine.map((x) => [x.id, x.event.seq, x.event.hash]), [[anchored[i].anchor, heads[i].seq, heads[i].hash]]);
    assert.equal((await replayNote(h, f.tenant)).headBefore.anchor, anchored[i].anchor, "the note names the anchor it read");
  }
  assert.deepEqual(noted, [[0, 3]], "the anchoring was in the operator journal before the loss (the restore then took that note with it)");
});

test("without an anchor, or with one that is behind the restored journal, the head before the loss is said unknown, not invented", async () => {
  // no anchor: the database was lost before anyone could read it
  const h = harness();
  const f = await founder(h);
  const b = backup(h);
  await removePasskey(h, f, "cred-2");
  restore(h, b);
  await h.app.operator.restoreReplay({ since: b.since });
  assert.equal((await replayNote(h, f.tenant)).headBefore, null);

  // an anchor older than the backup's snapshot (inside the margin of `since`): it is not the head before this loss
  const h2 = harness();
  const f2 = await founder(h2);
  const since = mark(h2);
  await h2.app.operator.restoreReplay({ anchor: true });
  tick(h2);
  await signIn(h2, "cred-1");
  const b2 = snapshot(h2);
  await removePasskey(h2, f2, "cred-2");
  restore(h2, b2);
  await h2.app.operator.restoreReplay({ since });
  assert.equal((await replayNote(h2, f2.tenant)).headBefore, null);

  // an anchor that is the restored head itself: nothing was lost, and the note says which head that is
  const h3 = harness();
  const f3 = await founder(h3);
  const b3 = backup(h3);
  await h3.app.operator.restoreReplay({ anchor: true });
  const at = await head(h3, f3.tenant);
  restore(h3, b3);
  await h3.app.operator.restoreReplay({ since: b3.since });
  const d = await replayNote(h3, f3.tenant);
  assert.deepEqual({ seq: d.headBefore.seq, hash: d.headBefore.hash }, at);
});

test("restore-replay's arguments: an anchor or a `since`, never a head for every tenant", async () => {
  const h = harness();
  await founder(h);
  const since = mark(h);
  assert.match(await refusal(h.app.operator.restoreReplay({})), /--since is malformed/);
  assert.match(await refusal(h.app.operator.restoreReplay({ since: "yesterday" })), /--since is malformed/);
  assert.match(await refusal(h.app.operator.restoreReplay({ since, recoveryHash: "abc" })), /--recovery-hash is malformed/);
  assert.match(await refusal(h.app.operator.restoreReplay({ anchor: true, since })), /--anchor takes no other argument/);
  assert.equal(h.store._state.operator.filter((n) => n.what.startsWith("restore-")).length, 0, "a refused call wrote nothing");
  const { parse, restoreArgs } = await import("../../src/operator.js");
  assert.deepEqual(restoreArgs(parse(["restore-replay", "--anchor"]).o), { since: null, anchor: true, recoveryHash: null });
  assert.deepEqual(restoreArgs(parse(["restore-replay", "--since", since, "--recovery-hash", "a".repeat(64)]).o), { since, anchor: false, recoveryHash: "a".repeat(64) });
  assert.throws(() => restoreArgs(parse(["restore-replay", "--since", since, "--head-before", "a".repeat(64)]).o), /--head-before is no longer taken/);
});

// ---------------------------------------------------------------- defect 2: the note says which entries are gone

test("the note says which entries are lost, by their seq, from the restored head to the tenant's head before the loss (runbook §3)", async () => {
  const h = harness();
  const fs = [await founder(h, { passkeys: 3, prefix: "a" }), await founder(h, { passkeys: 2, prefix: "b" }), await founder(h, { passkeys: 1, prefix: "c" })];
  const b = backup(h);
  await removePasskey(h, fs[0], "a-2");
  await removePasskey(h, fs[0], "a-3");
  await removePasskey(h, fs[1], "b-2");
  tick(h);
  await h.app.operator.restoreReplay({ anchor: true });
  const before = [];
  for (const f of fs) before.push(await head(h, f.tenant));
  restore(h, b);
  const after = [];
  for (const f of fs) after.push(await head(h, f.tenant));
  const report = await h.app.operator.restoreReplay({ since: b.since });

  // A lost two entries, B one, C none: computed here from the heads read before and after the loss
  const expected = [
    { from: after[0].seq + 1, to: before[0].seq, count: 2 },
    { from: after[1].seq + 1, to: before[1].seq, count: 1 },
    { from: null, to: null, count: 0 },
  ];
  for (const [i, f] of fs.entries()) {
    const entries = await journal(h, f.tenant);
    const note = entries.filter((e) => e.body.what === "restore-replayed").pop();
    assert.deepEqual(note.body.detail.lost, expected[i], `tenant ${i}: the note carries the range of the entries lost`);
    assert.deepEqual(note.body.detail.headAfterRestore, after[i], "and the restored head, with its seq");
    assert.equal(note.seq, after[i].seq + 1, "the note takes the first number after the restored head");
    assert.deepEqual(report[i].lost, expected[i], "the operator journal's row carries it too");
    assert.equal(verifyChain(entries).ok, true);
  }
  assert.equal(expected[0].to - expected[0].from, 1, "the control: the range is two entries wide");
});

test("the range is open when the head before the loss was not anchored, and the same when the gesture runs again", async () => {
  // no anchor: `to` is unknown, and said so
  const h = harness();
  const f = await founder(h);
  const b = backup(h);
  await removePasskey(h, f, "cred-2");
  restore(h, b);
  const restored = await head(h, f.tenant);
  await h.app.operator.restoreReplay({ since: b.since });
  assert.deepEqual((await replayNote(h, f.tenant)).lost, { from: restored.seq + 1, to: null, count: null });

  // run again after the journal went on (a sign-in, and an anchor taken after the restore by mistake):
  // the second note says the same range and the same heads as the first, and names it
  const h2 = harness();
  const f2 = await founder(h2);
  const b2 = backup(h2);
  await removePasskey(h2, f2, "cred-2");
  tick(h2);
  await h2.app.operator.restoreReplay({ anchor: true });
  restore(h2, b2);
  await h2.app.operator.restoreReplay({ since: b2.since });
  const first = (await journal(h2, f2.tenant)).pop();
  tick(h2);
  await signIn(h2, "cred-1");
  tick(h2);
  await h2.app.operator.restoreReplay({ anchor: true });
  tick(h2);
  await h2.app.operator.restoreReplay({ since: b2.since });
  const second = (await journal(h2, f2.tenant)).pop();
  assert.equal(second.body.what, "restore-replayed");
  assert.ok(second.seq > first.seq + 1, "the control: the journal went on between the two runs");
  for (const k of ["lost", "headAfterRestore", "headBefore"]) assert.deepEqual(second.body.detail[k], first.body.detail[k], `run again, the note says the same ${k}`);
  assert.deepEqual(first.body.detail.lost, { from: first.seq, to: first.seq, count: 1 });
  assert.equal(first.body.detail.rerunOf, undefined);
  assert.equal(second.body.detail.rerunOf, first.seq, "and names the first note of this replay");
});

// Code review of 2026-11-10, C12: run again with another `since` (an earlier one, because the first missed
// gestures), the gesture took its own first note for a part of the restored journal: the second note,
// permanent in the tenant's chained journal, said fewer entries lost, or an open range although the anchor
// was there. The two reproductions of the finding: three entries lost, then one.
test("C12: run again with another `since`, the note says the same lost range and the same heads as the first", async () => {
  for (const removals of [3, 1]) {
    const h = harness();
    const f = await founder(h, { passkeys: 4, prefix: "p" });
    const earlier = mark(h);
    const b = backup(h);
    for (let i = 0; i < removals; i++) await removePasskey(h, f, `p-${i + 2}`);
    tick(h);
    await h.app.operator.restoreReplay({ anchor: true });
    const before = await head(h, f.tenant);
    restore(h, b);
    const restored = await head(h, f.tenant);
    assert.notEqual(earlier, b.since, "the control: the two runs are given two different `since`");

    await h.app.operator.restoreReplay({ since: b.since });
    const first = (await journal(h, f.tenant)).pop();
    assert.deepEqual(first.body.detail.lost, { from: restored.seq + 1, to: before.seq, count: removals }, `${removals} lost: the first note`);
    tick(h);
    await h.app.operator.restoreReplay({ since: earlier });
    const second = (await journal(h, f.tenant)).pop();
    assert.equal(second.seq, first.seq + 1, "the control: the second note follows the first");
    assert.equal(second.body.detail.since, earlier);
    assert.deepEqual(second.body.detail.lost, { from: restored.seq + 1, to: before.seq, count: removals }, `${removals} lost: the second note says the same range`);
    for (const k of ["headAfterRestore", "headBefore"]) assert.deepEqual(second.body.detail[k], first.body.detail[k], `and the same ${k}`);
    assert.deepEqual(second.body.detail.headAfterRestore, restored);
    assert.equal(first.body.detail.rerunOf, undefined);
    assert.equal(second.body.detail.rerunOf, first.seq, "and names the first note of this restore's replay");
    assert.equal(verifyChain(await journal(h, f.tenant)).ok, true);
  }
});

test("C12: run again with a `since` that no longer reaches the anchor, the note carries the first note's range forward; a note of an earlier restore is never taken for this one's", async () => {
  const h = harness();
  const f = await founder(h, { passkeys: 4, prefix: "p" });
  // an earlier restore, replayed: its note is an entry of the journal like any other, and is in the next backup
  const b0 = backup(h);
  await removePasskey(h, f, "p-2");
  tick(h);
  await h.app.operator.restoreReplay({ anchor: true });
  restore(h, b0);
  await h.app.operator.restoreReplay({ since: b0.since });
  const earlierNote = (await journal(h, f.tenant)).pop();
  assert.equal(earlierNote.body.what, "restore-replayed");

  // this restore: two entries lost, anchored (the replay closed every session: the founder signs in again)
  tick(h);
  const g = { ...f, session: await h.app.identity.sessionFrom((await signIn(h, "p-1")).token) };
  const b = backup(h);
  await removePasskey(h, g, "p-3");
  await removePasskey(h, g, "p-4");
  tick(h);
  await h.app.operator.restoreReplay({ anchor: true });
  const before = await head(h, f.tenant);
  const late = mark(h); // after the anchor: a run with it reads no anchor
  restore(h, b);
  const restored = await head(h, f.tenant);
  assert.ok(restored.seq >= earlierNote.seq, "the control: the earlier restore's note came back with the backup");
  const range = { from: restored.seq + 1, to: before.seq, count: 2 };

  await h.app.operator.restoreReplay({ since: b.since });
  const first = (await journal(h, f.tenant)).pop();
  assert.deepEqual([first.body.detail.lost, first.body.detail.headAfterRestore, first.body.detail.rerunOf], [range, restored, undefined], "the first note of this restore is not a rerun of the earlier one's");
  tick(h);
  await h.app.operator.restoreReplay({ since: late });
  const second = (await journal(h, f.tenant)).pop();
  assert.equal((await h.objects.securitySince(f.tenant, late)).some((x) => x.event.what === "journal-anchored"), false, "the control: this `since` reaches no anchor");
  assert.deepEqual([second.body.detail.lost, second.body.detail.headAfterRestore, second.body.detail.rerunOf], [range, restored, first.seq]);
  assert.deepEqual(second.body.detail.headBefore, first.body.detail.headBefore, "the head before the loss is the one the first note read");
});

// Code review of 2026-11-10 (of d569c95), C19: no test pinned the bound restoredHead takes from the anchors
// of lost entries. With `ulidTime(since)` alone the file stayed green, because the test above gives a
// `since` that is already after the earlier restore's note. Here `since` precedes that note, as an operator
// who reaches back for missed gestures gives it, and this loss is anchored: the anchor was taken after the
// earlier note, so that note is not this restore's first.
test("C19: with a `since` that precedes an earlier restore's note, an anchored loss is still read from the restored head, not from that note", async () => {
  const h = harness();
  const f = await founder(h, { passkeys: 4, prefix: "p" });
  const early = mark(h); // before the earlier restore, its replay and its note
  const earlyAt = h.clock.now();
  const b0 = backup(h);
  await removePasskey(h, f, "p-2");
  tick(h);
  await h.app.operator.restoreReplay({ anchor: true });
  restore(h, b0);
  await h.app.operator.restoreReplay({ since: b0.since });
  const earlierNote = (await journal(h, f.tenant)).pop();
  assert.equal(earlierNote.body.what, "restore-replayed");

  // this restore: two entries lost, anchored after the earlier note
  tick(h);
  const g = { ...f, session: await h.app.identity.sessionFrom((await signIn(h, "p-1")).token) };
  const b = backup(h);
  await removePasskey(h, g, "p-3");
  await removePasskey(h, g, "p-4");
  tick(h);
  await h.app.operator.restoreReplay({ anchor: true });
  const before = await head(h, f.tenant);
  restore(h, b);
  const restored = await head(h, f.tenant);
  assert.ok(restored.seq > earlierNote.seq, "the control: the earlier restore's note came back with the backup, and the journal went on after it");
  assert.ok(early < b0.since && Date.parse(earlierNote.body.dates.received.at) > earlyAt, "the control: this `since` precedes the earlier restore's note");

  await h.app.operator.restoreReplay({ since: early });
  const note = (await journal(h, f.tenant)).pop();
  assert.equal(note.body.what, "restore-replayed");
  assert.equal(note.body.detail.since, early);
  // without the bound, the earlier note is taken for this replay's first: the head is the entry before
  // it, the range is the earlier restore's, and the note calls itself a rerun
  assert.deepEqual(note.body.detail.headAfterRestore, restored, "the restored head is the journal's last entry, not the entry before the earlier note");
  assert.deepEqual(note.body.detail.lost, { from: restored.seq + 1, to: before.seq, count: 2 });
  assert.deepEqual({ seq: note.body.detail.headBefore.seq, hash: note.body.detail.headBefore.hash }, before);
  assert.equal(note.body.detail.rerunOf, undefined, "and it is not a rerun of the earlier restore's replay");
  assert.equal(note.seq, restored.seq + 1);
});

// Code review of 2026-11-10 (of d569c95), C17: an anchor taken after the restore and before its replay is
// of the restored head, and the replay read it as the head before the loss. The reproduction: anchor at
// the head, three entries lost by the restore, `--anchor` again by mistake, then the replay: a permanent
// note of 0 entries lost, although three were lost and their anchor was in the log.
test("C17: `restore-replay --anchor` is refused restore-not-replayed when a restore is waiting for its replay; nothing is anchored, and the replay still says what was lost", async () => {
  const h = harness();
  const f = await founder(h, { passkeys: 4, prefix: "p" });
  const other = await founder(h, { passkeys: 1, prefix: "q" });
  const b = backup(h);
  for (const cred of ["p-2", "p-3", "p-4"]) await removePasskey(h, f, cred);
  tick(h);
  await h.app.operator.restoreReplay({ anchor: true });
  const before = await head(h, f.tenant);
  restore(h, b);
  const restored = await head(h, f.tenant);
  const anchorsOf = async (tenant) => (await h.objects.securitySince(tenant, "")).filter((x) => x.event.what === "journal-anchored").length;
  assert.deepEqual([await anchorsOf(f.tenant), await anchorsOf(other.tenant)], [1, 1]);

  // by mistake: the anchor again, after the restore and before the replay
  tick(h);
  let e = null;
  try { await h.app.operator.restoreReplay({ anchor: true }); } catch (x) { e = x; }
  assert.equal(e?.code, "restore-not-replayed", `a refusal with its code, not ${e?.constructor.name}: ${e?.message}`);
  assert.match(e.message, /^restore-not-replayed: the latest anchor of 1 tenant\(s\) out of 2 names an entry the journal no longer holds, and no replay was noted since/);
  // refused whole, before any write: no anchor for any tenant, the one that lost nothing included
  assert.deepEqual([await anchorsOf(f.tenant), await anchorsOf(other.tenant)], [1, 1], "nothing was anchored");
  const refusedNote = notes(h, "restore-anchored").pop();
  assert.deepEqual({ refused: refusedNote.detail.refused, failed: refusedNote.detail.failed, report: refusedNote.detail.report.map((r) => [r.tenant, r.anchored, r.head]) }, { refused: "restore-not-replayed", failed: 1, report: [[f.tenant, before.seq, restored.seq]] });

  // the replay then says the three entries lost (with the second anchor, it said 0)
  tick(h);
  await h.app.operator.restoreReplay({ since: b.since });
  const d = await replayNote(h, f.tenant);
  assert.deepEqual(d.lost, { from: restored.seq + 1, to: before.seq, count: 3 });
  assert.deepEqual(d.headAfterRestore, restored);

  // once the replay has run, the next anchor is taken: of the journal as it now is
  tick(h);
  const again = await h.app.operator.restoreReplay({ anchor: true });
  assert.deepEqual(again.map((r) => r.failed), [undefined, undefined]);
  assert.deepEqual([await anchorsOf(f.tenant), await anchorsOf(other.tenant)], [2, 2]);
  // and an anchor that is the journal's own entry never refuses the next one
  tick(h);
  assert.equal((await h.app.operator.restoreReplay({ anchor: true })).length, 2);
});

test("C17: `restore-replay --anchor` is refused whole when a tenant's security log cannot be read: it cannot tell whether a restore is waiting", async () => {
  const h = harness();
  const f = await founder(h);
  await h.app.operator.restoreReplay({ anchor: true });
  unreadable(h, f.tenant);
  const e = await h.app.operator.restoreReplay({ anchor: true }).then(() => null, (x) => x);
  assert.equal(e?.code, "security-log-unreadable", `a refusal with its code, not ${e?.constructor.name}: ${e?.message}`);
  assert.match(e.message, /^security-log-unreadable: the security log of 1 tenant\(s\) out of 1 cannot be read; nothing was anchored/);
  assert.equal(notes(h, "restore-anchored").pop().detail.refused, "security-log-unreadable");
  delete h.objects._map.has;
  assert.equal((await h.app.operator.restoreReplay({ anchor: true })).length, 1, "the object store answers again: the anchor is taken");
});
