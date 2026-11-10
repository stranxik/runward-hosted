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
