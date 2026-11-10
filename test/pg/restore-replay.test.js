// T24 against a real PostgreSQL: the restore drill of runbook §16, as a test. Three tenants are made
// through the application (the service under rw_app, the operator's gestures under rw_maint), a backup is
// taken at T (a copy of the database), gestures happen after T, the database is dropped and replaced by the
// backup, then `restoreReplay` runs under rw_maint and the accesses are read as a person meets them. What
// the in-memory suite (test/unit/restore-replay.test.js) cannot show is shown here: the gesture holds
// within rw_maint's grants and the forced row level security, on real transactions.
// Needs PG_ADMIN_URL (a superuser of a throwaway server). Run on the NAS, never against a real base.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { migrate } from "../../scripts/migrate.mjs";
import { postgresStore } from "../../src/adapters/store/postgres.js";
import { ulid } from "../../src/adapters/system/ulid.js";
import { harness, founder, gesture, pinnedRepository, send, sha, markedCheck, contentLeft } from "../helpers.js";
import { untar } from "../../src/adapters/archive/tar.js";

const ADMIN = process.env.PG_ADMIN_URL;
if (!ADMIN) { test("PG_ADMIN_URL is set", () => assert.fail("PG_ADMIN_URL is required: this suite never skips silently")); }
const DB = `rw_restore_${randomBytes(4).toString("hex")}`;
const BACKUP = `${DB}_backup`;
const urlAs = (role) => { const u = new URL(ADMIN); u.username = role; u.password = ""; u.pathname = `/${DB}`; return u.toString(); };
const refusal = async (p) => { try { await p; return null; } catch (e) { return e.code ?? e.message; } };
const tok = () => randomBytes(32).toString("base64url");
const pause = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// One application on one object store, as in production; its store follows the database through its
// replacement and connects as the role of who acts: rw_app for the service, rw_maint for the operator.
let admin, h, role = "rw_app";
const open = new Map();
const pool = () => { if (!open.has(role)) open.set(role, postgresStore({ url: urlAs(role), ssl: false })); return open.get(role); };
const closeAll = async () => { for (const s of open.values()) await s.close(); open.clear(); };
const store = { kind: "postgres", tx: (tenant, fn) => pool().tx(tenant, fn), newId: () => randomUUID(), ping: () => pool().ping(), close: closeAll };
/** An operator's gesture: under rw_maint, as src/operator.js runs it. */
async function operator(fn) { role = "rw_maint"; try { return await fn(h.app.operator); } finally { role = "rw_app"; } }

const grants = () => admin.unsafe(`grant create, connect on database ${DB} to rw_owner; grant connect on database ${DB} to rw_app, rw_maint`);
/** T: the backup (a copy of the database, every connection closed), and the ULID of its instant. */
async function backup() {
  await pause();
  const since = ulid(Date.now()).slice(0, 10) + "0".repeat(16);
  await pause();
  await closeAll();
  await admin.unsafe(`drop database if exists ${BACKUP}`);
  await admin.unsafe(`create database ${BACKUP} template ${DB}`);
  return since;
}
/** The loss: the database is dropped and replaced by the backup. The object store is untouched. */
async function restore() {
  await closeAll();
  await admin.unsafe(`drop database ${DB} with (force)`);
  await admin.unsafe(`create database ${DB} template ${BACKUP}`);
  await grants();
}

before(async () => {
  if (!ADMIN) return;
  admin = postgres(ADMIN, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${DB}`);
  for (const r of ["rw_owner login", "rw_resolve nologin", "rw_app login nobypassrls", "rw_maint login nobypassrls"]) {
    const [name] = r.split(" ");
    const [x] = await admin`select 1 from pg_roles where rolname = ${name}`;
    if (!x) await admin.unsafe(`create role ${r}`);
  }
  await admin.unsafe("grant rw_resolve to rw_owner");
  await grants();
  process.env.DATABASE_SSL = "disable";
  await migrate(urlAs("rw_owner"), { log: () => {} });
  h = harness({ store, realTime: true, config: { jobRetryWaits: [0, 0] } });
});
after(async () => {
  if (!ADMIN) return;
  await closeAll();
  await admin.unsafe(`drop database if exists ${DB} with (force)`);
  await admin.unsafe(`drop database if exists ${BACKUP} with (force)`);
  await admin.end();
});

/** What the observer reads: the operator journal, as the server's superuser (no gesture uses this). */
async function operatorNotes(what) {
  const u = new URL(ADMIN); u.pathname = `/${DB}`;
  const sql = postgres(u.toString(), { max: 1, onnotice: () => {} });
  try { return (await sql`select detail from rw.operator_journal where what = ${what} order by seq desc`).map((r) => r.detail); } finally { await sql.end(); }
}
const replayNotes = async (t, since) => (await store.tx(t, (tx) => tx.ledgerAll())).filter((e) => e.body.what === "restore-replayed" && e.body.detail.since === since);

async function tenant(prefix, passkeys) {
  const t = tok();
  const o = await operator((op) => op.openBootstrap({ hash: sha(Buffer.from(t)) }));
  return founder(h, { prefix, passkeys, token: t, tenant: o.tenant });
}
async function signIn(cred) {
  const o = await h.app.identity.signInOptions();
  return h.app.identity.signIn({ challengeId: o.challengeId, response: { id: cred, challenge: o.options.challenge } });
}
const rows = (t, table, where = {}) => store.tx(t, (tx) => tx.list(table, where));
const passkey = async (t, cred) => (await rows(t, "passkey")).find((p) => p.credentialId === cred);
const live = async (t, table) => (await rows(t, table)).filter((r) => !r.removedAt).length;
async function removePasskey(f, cred) {
  await pause();
  const p = await passkey(f.tenant, cred);
  await gesture(h, f.session, "passkey-remove", p.id);
  await h.app.identity.passkeyRemove(f.session, p.id, {});
}

test("the drill of runbook §16: a reset, removals and an erasure after the backup, the restore, the replay under rw_maint", async () => {
  const A = await tenant("a", 3), B = await tenant("b", 2), C = await tenant("c", 1);
  const second = await signIn("a-2");
  const repo = await pinnedRepository(h, B, { name: "drill/beta", mission: "drill-beta", claims: { repository_id: "7001" } });
  const since = await backup();

  // after T. A: a-2 removed (its session closes with it) then restored, a-3 removed for good. B: the
  // content of its repository erased. C: its access reset by the operator (the intruder).
  await removePasskey(A, "a-2");
  await pause();
  await gesture(h, A.session, null, null);
  await h.app.identity.passkeyRestore(A.session, (await passkey(A.tenant, "a-2")).id, {});
  await removePasskey(A, "a-3");
  await gesture(h, B.session, "content-erase", repo.id);
  await h.app.repositories.eraseContent(B.session, repo.id, {});
  await operator((op) => op.resetAccess({ hash: sha(Buffer.from(tok())), tenant: C.tenant }));
  assert.equal(await refusal(signIn("c-1")), "passkey-unknown", "before the loss: the reset withdrew C's passkey");
  assert.equal(await refusal(signIn("a-3")), "passkey-unknown", "before the loss: a-3 opens nothing");

  // before the loss, while the database can still be read: each tenant's head is anchored in the object store
  await operator((op) => op.restoreReplay({ anchor: true }));
  const heads = new Map();
  for (const f of [A, B, C]) heads.set(f.tenant, await store.tx(f.tenant, (tx) => tx.ledgerHead()));

  await restore();
  const restored = new Map();
  for (const f of [A, B, C]) restored.set(f.tenant, await store.tx(f.tenant, (tx) => tx.ledgerHead()));
  // the control (what the drill found at 7f00128): the restore alone gives the withdrawn accesses back
  assert.deepEqual([await live(C.tenant, "member"), await live(C.tenant, "passkey")], [1, 1], "the restore gave C's member and passkey back");
  assert.ok(await h.app.identity.sessionFrom(second.token), "and the session closed with a-2");
  assert.equal((await rows(B.tenant, "upload")).filter((u) => !u.erasedAt).length, 1, "and counts bytes the object store no longer has");

  const report = await operator((op) => op.restoreReplay({ since }));
  const of = (f) => report.find((r) => r.tenant === f.tenant);

  // tenant C: the passkey the reset withdrew opens no session (T24, the intruder's case)
  assert.equal(await refusal(signIn("c-1")), "passkey-unknown", "the passkey withdrawn by the reset after the backup must open no session");
  assert.deepEqual([await live(C.tenant, "member"), await live(C.tenant, "passkey")], [0, 0], "no member, no passkey");
  assert.equal(await h.app.identity.sessionFrom(C.token), null);
  assert.deepEqual({ closed: of(C).closed, replayed: of(C).replayed, memberless: of(C).memberless }, { closed: 1, replayed: 1, memberless: true });
  // tenant A: the order of the log, and the sessions of before the loss
  assert.deepEqual({ closed: of(A).closed, replayed: of(A).replayed, memberless: of(A).memberless }, { closed: 2, replayed: 3, memberless: false });
  assert.equal(await h.app.identity.sessionFrom(A.token), null, "a session of before the loss opens nothing");
  assert.equal(await h.app.identity.sessionFrom(second.token), null);
  assert.equal(await refusal(signIn("a-3")), "passkey-unknown", "removed for good");
  assert.ok((await signIn("a-2")).token, "removed then restored: it signs in");
  // tenant B: the erased content is erased again, and the next upload is assembled without it
  assert.deepEqual({ closed: of(B).closed, replayed: of(B).replayed }, { closed: 1, replayed: 1 });
  assert.equal((await rows(B.tenant, "upload")).filter((u) => !u.erasedAt).length, 0);
  // the version of its index built from that content, which the restore gave back whole, holds no byte again
  // (rw_maint's grant on rw.fleet_index is that erasure), and no erased index is served meanwhile
  assert.deepEqual((await rows(B.tenant, "fleet_index")).map((v) => [v.version, v.bytes.length, v.erasedAt != null]), [[1, 0, true]]);
  assert.equal(await h.app.reading.index(B.tenant), null);
  const sent = await send(h, { repository: "drill/beta", repository_id: "7001", run_number: "7", run_id: "40000000007" }, { mission: "drill-beta" });
  assert.equal(sent.status, 201);
  assert.equal((await h.app.reading.index(B.tenant)).version, 2, "the next upload publishes a version after the erased one");

  // each tenant's note carries the head of its own journal before the loss (the drill found tenant A's in the three)
  for (const f of [A, B, C]) {
    const [note] = await replayNotes(f.tenant, since);
    assert.deepEqual({ seq: note.body.detail.headBefore?.seq, hash: note.body.detail.headBefore?.hash }, heads.get(f.tenant), "the note carries the head of its own tenant's journal before the loss");
  }
  assert.equal(new Set([...heads.values()].map((x) => x.hash)).size, 3, "the control: three chains, three heads");
  // and which entries are gone, by their seq, as runbook §3 says of the note
  for (const f of [A, B, C]) {
    const [note] = await replayNotes(f.tenant, since);
    const from = restored.get(f.tenant).seq + 1, to = heads.get(f.tenant).seq;
    assert.deepEqual(note.body.detail.lost, { from, to, count: to - from + 1 }, "the note carries the range of the entries lost");
    assert.deepEqual(note.body.detail.headAfterRestore, restored.get(f.tenant));
    assert.equal(note.seq, from);
  }
  // every chain holds, from its first entry to the note
  const chains = await operator((op) => op.verifyChains());
  assert.deepEqual(chains.map((c) => c.ok), [true, true, true]);
  // the bootstrap the reset opened is gone with the restore: the operator opens one again, a founder arrives
  const t = tok();
  await operator((op) => op.openBootstrap({ hash: sha(Buffer.from(t)), tenant: C.tenant }));
  const again = await founder(h, { prefix: "c2", passkeys: 1, token: t, tenant: C.tenant });
  assert.ok(again.session, "C is opened again by its rightful founder");
});

test("a tenant whose replay fails is rolled back whole by PostgreSQL and recorded; the tenant after it is replayed", async () => {
  const D = await tenant("d", 2), E = await tenant("e", 2);
  const since = await backup();
  await removePasskey(D, "d-2");
  await removePasskey(E, "e-2");
  await restore();
  // D's transaction fails at its end, after every write of the replay, at each of its three attempts
  const real = store.tx;
  let attempts = 0;
  store.tx = (t, fn) => (t === D.tenant ? real(t, async (tx) => { await fn(tx); attempts++; throw new Error(`planted failure ${attempts}`); }) : real(t, fn));
  const report = await operator((op) => op.restoreReplay({ since })).catch((e) => e).finally(() => { store.tx = real; });
  assert.ok(Array.isArray(report), `the gesture reports instead of stopping at the failing tenant: ${report.message}`);
  const of = (f) => report.find((r) => r.tenant === f.tenant);
  assert.deepEqual({ failed: of(D).failed, attempts: of(D).attempts, error: of(D).error }, { failed: true, attempts: 3, error: "planted failure 3" });
  assert.equal((await rows(D.tenant, "session")).filter((x) => !x.closedAt).length, 1, "D: the session the failed replay closed is open again (rolled back)");
  assert.equal((await passkey(D.tenant, "d-2")).removedAt, null, "D: the removal is not half replayed");
  assert.equal((await replayNotes(D.tenant, since)).length, 0, "D: no note in its journal");
  assert.deepEqual({ failed: of(E).failed, replayed: of(E).replayed }, { failed: undefined, replayed: 1 });
  assert.equal(await refusal(signIn("e-2")), "passkey-unknown", "E, after the failing tenant, is replayed");
  const [note] = await operatorNotes("restore-replayed");
  assert.deepEqual({ since: note.since, failed: note.failed, rows: note.report.length }, { since, failed: 1, rows: report.length }, "the failure is in the operator journal");
  // run again once the cause is gone
  const again = await operator((op) => op.restoreReplay({ since }));
  assert.equal(again.some((r) => r.failed), false);
  assert.equal(await refusal(signIn("d-2")), "passkey-unknown");
  assert.ok((await signIn("d-1")).token);
});

// Review finding C22 of 2026-11-10: the erasure the retention job makes 30 days after a removal wrote no
// security event, so a restore from a backup of before the pass had nothing to replay: the versions came
// back whole and stayed so until the next daily pass, and an archive prepared meanwhile packed them.
test("a restore from a backup of before the retention erasure: under rw_maint the pass writes its event, the archive on the restored base packs nothing whose bytes are gone, and the replay empties the versions again", async () => {
  const MARK = "RETAINED-RUN-2";
  const T = await tenant("ret", 2);
  const repo = await pinnedRepository(h, T, { name: "drill/retained", mission: "drill-retained", claims: { repository_id: "7101", run_id: "397101" } });
  assert.equal((await send(h, { repository: "drill/retained", repository_id: "7101", run_number: "2", run_id: "427101" }, { mission: "drill-retained", bytes: markedCheck(MARK) })).status, 201);
  await gesture(h, T.session, null, null);
  await h.app.repositories.remove(T.session, repo.id, {});
  // 31 days pass: the removal is dated back by the server's superuser (the application's clock is the real one)
  const asAdmin = async (fn) => { const u = new URL(ADMIN); u.pathname = `/${DB}`; const sql = postgres(u.toString(), { max: 1, onnotice: () => {} }); try { return await fn(sql); } finally { await sql.end(); } };
  await asAdmin(async (sql) => {
    await sql`update rw.repository set removed_at = removed_at - interval '31 days' where id = ${repo.id}`;
    await sql`update rw.forge_repository set removed_at = removed_at - interval '31 days' where id = ${repo.id}`;
  });
  const whole = (versions) => versions.map((v) => [v.version, v.bytes.length > 0, v.erasedAt != null]);
  const since = await backup();

  // after T: the daily pass, as rw_maint
  const before = (await store.tx(T.tenant, (tx) => tx.ledgerAll())).length;
  const pass = await operator((op) => op.retention());
  const mine = pass.find((r) => r.tenant === T.tenant);
  assert.deepEqual([mine.failed ?? false, mine.erased, mine.indexVersions], [false, 2, 2], JSON.stringify(mine));
  assert.deepEqual(whole(await rows(T.tenant, "fleet_index")), [[1, false, true], [2, false, true], [3, true, false]]);
  // one entry, which names the repository, its digests and the versions emptied (C26)
  const entries = await store.tx(T.tenant, (tx) => tx.ledgerAll());
  assert.equal(entries.length, before + 1, "the pass wrote one entry in the tenant's journal");
  const last = entries[entries.length - 1].body;
  assert.deepEqual([last.who.type, last.what, last.object, last.detail.indexVersions, last.detail.reason, last.detail.digests.length], ["operator", "content-erased", repo.id, [1, 2], "retention", 2]);
  assert.deepEqual(await contentLeft(h, T.tenant, [MARK]), [], "the pass left nothing of the content");

  await restore();
  // the control: the restored base holds the erased content again and counts uploads whose bytes are gone
  assert.deepEqual(await contentLeft(h, T.tenant, [MARK]), [`fleet_index version 2 bytes: ${MARK}`]);
  assert.equal((await rows(T.tenant, "upload")).filter((u) => !u.erasedAt).length, 2);

  // before the replay: an archive prepared on the restored base brings none of it back
  await gesture(h, T.session, "export", "");
  const early = await h.app.reading.prepareExport(await h.app.identity.sessionFrom(T.token), {});
  const names = untar(early.bytes).map((f) => f.name);
  assert.deepEqual([1, 2, 3].map((n) => names.includes(`versions/${n}/index.json`)), [false, false, true], "no index.json for a version whose exports cannot be read");
  assert.deepEqual((await contentLeft(h, T.tenant, [MARK], early.bytes)).filter((w) => !w.startsWith("fleet_index ")), [], "no file of the archive, and no object, holds the content");
  const plan = JSON.parse(untar(early.bytes).find((f) => f.name === "replay.json").bytes.toString("utf8"));
  assert.deepEqual(plan.versions.map((v) => [v.version, v.replayable, v.why ?? null, v.indexWithheld ?? false]), [[1, false, "bytes missing", true], [2, false, "bytes missing", true], [3, true, null, false]]);

  const report = await operator((op) => op.restoreReplay({ since }));
  const of = report.find((r) => r.tenant === T.tenant);
  assert.deepEqual([of.failed ?? false, of.replayed], [false, 1], "the retention erasure is replayed, as an erasure on request is");
  assert.deepEqual(whole(await rows(T.tenant, "fleet_index")), [[1, false, true], [2, false, true], [3, true, false]], "the versions built from the erased content are emptied again");
  assert.deepEqual(await contentLeft(h, T.tenant, [MARK]), []);
  assert.equal((await rows(T.tenant, "upload")).filter((u) => !u.erasedAt).length, 0, "the uploads are marked erased again");
  assert.equal((await h.app.reading.index(T.tenant)).version, 3, "the index served is the one the removal published");
});
