// Erasure reaches the published versions of the index, against a real PostgreSQL (ADR-0009; design
// decision D5 of 2026-11-10, lot E1; db/migrations/0006). What the in-memory suite
// (test/unit/erasure.test.js) cannot show is shown here: the erasure holds within the grants of rw_app
// (the service) and of rw_maint (the retention job), under the forced row level security, and the
// database itself holds a published version to what it is (the check and the trigger of 0006). The
// content is looked for twice: through the application, as the tenant reads it, and as the server's
// superuser, across every tenant, so that a row the row level security hides is seen too.
// Needs PG_ADMIN_URL (a superuser of a throwaway server). Run on the NAS, never against a real base.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { migrate } from "../../scripts/migrate.mjs";
import { postgresStore } from "../../src/adapters/store/postgres.js";
import { harness, founder, gesture, send, sha, markedCheck, contentLeft, withoutIndexErasure, erasureScenario, GONE, KEEP, BRAVO } from "../helpers.js";
import { replay } from "../../scripts/replay-export.mjs";
import { untar } from "../../src/adapters/archive/tar.js";
import { verifyChain } from "../../src/domain/ledger.js";

const ADMIN = process.env.PG_ADMIN_URL;
if (!ADMIN) { test("PG_ADMIN_URL is set", () => assert.fail("PG_ADMIN_URL is required: this suite never skips silently")); }
const DB = `rw_erasure_${randomBytes(4).toString("hex")}`;
const urlAs = (role) => { const u = new URL(ADMIN); u.username = role; u.password = ""; u.pathname = `/${DB}`; return u.toString(); };
const refusal = async (p) => { try { await p; return null; } catch (e) { return e.code ?? e.message; } };
const tok = () => randomBytes(32).toString("base64url");

// One application on one object store; its store connects as the role of who acts: rw_app for the
// service, rw_maint for the operator's gestures and the daily jobs. `plant.on` makes it the store of the
// planted control (index versions never emptied: the erasure of before 0006).
let admin, adminDb, h, role = "rw_app";
const open = new Map();
const pool = () => { if (!open.has(role)) open.set(role, postgresStore({ url: urlAs(role), ssl: false })); return open.get(role); };
const closeAll = async () => { for (const s of open.values()) await s.close(); open.clear(); };
const plant = { on: false };
// The interleaving of two real transactions, forced (review finding C21): the next transaction that
// reaches `hold.at` (a store method and its arguments) waits there, on its own connection, until the test
// releases it. What it holds then (the tenant lock, its uncommitted rows) it keeps while another runs.
const hold = { at: null };
function holdNext(at) {
  const h1 = {};
  h1.reached = new Promise((r) => { h1.arrive = r; });
  h1.gate = new Promise((r) => { h1.release = r; });
  Object.assign(hold, { at, arrive: h1.arrive, gate: h1.gate });
  return h1;
}
const holding = (t) => new Proxy(t, {
  get(target, k) {
    const v = target[k];
    if (typeof v !== "function") return v;
    return async (...args) => {
      if (hold.at?.(k, args)) { const { arrive, gate } = hold; hold.at = null; arrive(); await gate; }
      return v.apply(target, args);
    };
  },
});
const store = withoutIndexErasure({ kind: "postgres", tx: (tenant, fn) => pool().tx(tenant, (t) => fn(holding(t))), newId: () => randomUUID(), ping: () => pool().ping(), close: closeAll }, plant);
async function operator(fn) { role = "rw_maint"; try { return await fn(h.app.operator); } finally { role = "rw_app"; } }

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
  await admin.unsafe(`grant create, connect on database ${DB} to rw_owner; grant connect on database ${DB} to rw_app, rw_maint`);
  process.env.DATABASE_SSL = "disable";
  await migrate(urlAs("rw_owner"), { log: () => {} });
  const u = new URL(ADMIN); u.pathname = `/${DB}`;
  adminDb = postgres(u.toString(), { max: 1, onnotice: () => {} });
  h = harness({ store, realTime: true, config: { jobRetryWaits: [0, 0] } });
});
after(async () => {
  if (!ADMIN) return;
  await closeAll();
  await adminDb?.end();
  await admin.unsafe(`drop database if exists ${DB} with (force)`);
  await admin.end();
});

async function tenant(prefix) {
  const t = tok();
  const o = await operator((op) => op.openBootstrap({ hash: sha(Buffer.from(t)) }));
  return founder(h, { prefix, token: t, tenant: o.tenant });
}
const session = (f) => h.app.identity.sessionFrom(f.token);
async function exported(f) {
  await gesture(h, f.session, "export", "");
  return h.app.reading.prepareExport(await session(f), {});
}
async function erase(f, repository) {
  await gesture(h, f.session, "content-erase", repository);
  return h.app.repositories.eraseContent(await session(f), repository, {});
}
/** The versions of a tenant as the table holds them, read by the superuser (no row level security). */
const versions = async (t) => adminDb`select version, octet_length(bytes)::int as bytes, erased_at is not null as erased, sha256, manifest_sha256, seq::int as seq, published_at, encode(sha256(bytes), 'hex') as bytes_sha256, encode(sha256(manifest), 'hex') as manifest_bytes_sha256 from rw.fleet_index where tenant_id = ${t} order by version`.then((rows) => rows.map((r) => ({ ...r })));
const shape = (rows) => rows.map((v) => ({ version: v.version, bytes: v.bytes > 0, erased: v.erased }));
/** Every row of rw.fleet_index, of any tenant, whose bytes hold one of the markers: read by the superuser. */
async function inAnyVersion(markers) {
  const out = [];
  for (const m of markers) for (const r of await adminDb`select tenant_id, version from rw.fleet_index where position(convert_to(${m}, 'UTF8') in bytes) > 0 order by tenant_id, version`) out.push(`${r.tenant_id} version ${r.version}: ${m}`);
  return out;
}

/** Wait until a transaction of this database waits for a tenant lock another holds: the erasure met the transaction in flight. */
async function waitsForTheLock() {
  for (let i = 0; i < 400; i++) {
    const [r] = await adminDb`select count(*)::int as n from pg_locks l join pg_database d on d.oid = l.database where d.datname = ${DB} and l.locktype = 'advisory' and not l.granted`;
    if (r.n > 0) return;
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error("no transaction waits for the tenant lock: the interleaving was not reached");
}
/** The same search, kept to one tenant's rows: the base is shared by the cases of this file, and an earlier one leaves its content whole. */
const inVersionsOf = async (t, markers) => (await inAnyVersion(markers)).filter((w) => w.startsWith(`${t} `));
const uploadsOf = async (t, repository) => (await h.store.tx(t, (tx) => tx.list("upload", { repositoryRef: repository }))).map((u) => ({ rank: u.rank, erased: u.erasedAt != null }));

test("on PostgreSQL, as rw_app: erasing a repository's content empties every version built from it, in the table itself; the archive brings nothing back; another tenant is untouched", async () => {
  const A = await tenant("a"), B = await tenant("b");
  const { gone } = await erasureScenario(h, A, B);
  const before = await versions(A.tenant), beforeB = await versions(B.tenant);
  assert.deepEqual(before.map((v) => [v.version, v.bytes > 0]), [[1, true], [2, true], [3, true], [4, true], [5, true]]);
  const old = await exported(A);
  // the control of both searches: before the erasure they find the content
  assert.deepEqual(await inAnyVersion(GONE), [`${A.tenant} version 4: GONE-RUN-1`, `${A.tenant} version 5: GONE-RUN-2`]);
  const found = await contentLeft(h, A.tenant, GONE, old.bytes);
  for (const where of ["fleet_index version 4 bytes: GONE-RUN-1", "fleet_index version 5 bytes: GONE-RUN-2", "object sha256: GONE-RUN-2", "object archives: GONE-RUN-2", "archive versions/5/index.json: GONE-RUN-2"]) assert.ok(found.includes(where), `${where}: ${JSON.stringify(found)}`);

  const out = await erase(A, gone.id);
  const now = await versions(A.tenant);
  assert.deepEqual(shape(now), [
    { version: 1, bytes: true, erased: false }, { version: 2, bytes: true, erased: false },
    { version: 3, bytes: false, erased: true }, { version: 4, bytes: false, erased: true }, { version: 5, bytes: false, erased: true },
    { version: 6, bytes: true, erased: false },
  ], "the versions built from the repository hold no byte in the table");
  for (const v of before) {
    const n = now.find((x) => x.version === v.version);
    assert.deepEqual({ sha256: n.sha256, manifestSha256: n.manifest_sha256, seq: n.seq, publishedAt: n.published_at.getTime(), manifest: n.manifest_bytes_sha256 }, { sha256: v.sha256, manifestSha256: v.manifest_sha256, seq: v.seq, publishedAt: v.published_at.getTime(), manifest: v.manifest_bytes_sha256 }, `version ${v.version} keeps its digests, its seq and its fleet.json`);
  }
  for (const v of now.filter((x) => !x.erased)) assert.equal(v.bytes_sha256, v.sha256, `version ${v.version}: the bytes kept are the bytes published`);

  const fresh = await exported(A);
  assert.deepEqual(await inAnyVersion(GONE), [], "no row of rw.fleet_index, of any tenant, holds a byte of the erased content");
  assert.deepEqual(await contentLeft(h, A.tenant, GONE, fresh.bytes), [], "nor does a version, an object, the journal or the archive, as the tenant reads them");
  assert.equal(await refusal(h.app.reading.downloadExport(await session(A), old.id)), "not-found", "the archive prepared before the erasure went with it");
  const names = untar(fresh.bytes).map((f) => f.name);
  for (const n of [3, 4, 5]) assert.deepEqual([names.includes(`versions/${n}/index.json`), names.includes(`versions/${n}/fleet.json`)], [false, true], `version ${n}: no index.json in the archive, its fleet.json stays`);
  const plan = JSON.parse(untar(fresh.bytes).find((f) => f.name === "replay.json").bytes.toString("utf8"));
  assert.deepEqual(plan.versions.map((v) => [v.version, v.replayable, v.indexErased ?? false]), [[1, true, false], [2, true, false], [3, false, true], [4, false, true], [5, false, true], [6, true, false]]);
  assert.equal(replay(fresh.bytes, "0.46.0").ok, true);
  const entries = await h.store.tx(A.tenant, (tx) => tx.ledgerAll());
  const entry = entries.find((e) => e.seq === out.entry.seq);
  assert.deepEqual([entry.body.what, entry.body.detail.indexVersions, entry.body.detail.indexVersion], ["content-erased", [3, 4, 5], 6]);
  assert.equal(verifyChain(entries).ok, true);
  assert.equal((await h.app.reading.index(A.tenant)).version, 6);
  assert.ok((await contentLeft(h, A.tenant, KEEP)).includes("fleet_index version 6 bytes: KEEP-RUN-1"), "the tenant's other repository keeps its content");

  // the other tenant: every row of its versions is what it was, and its content is still there
  assert.deepEqual(await versions(B.tenant), beforeB, "nothing of the other tenant's versions moved");
  const b = await exported(B);
  const left = await contentLeft(h, B.tenant, BRAVO, b.bytes);
  for (const where of ["fleet_index version 2 bytes: BRAVO-RUN-1", "object sha256: BRAVO-RUN-1", "archive versions/2/index.json: BRAVO-RUN-1"]) assert.ok(left.includes(where), `${where}: ${JSON.stringify(left)}`);
  assert.equal(replay(b.bytes, "0.46.0").ok, true);
});

test("planted control on PostgreSQL: an erasure that does not reach the index versions (the code before 0006) leaves the content in rw.fleet_index, and both searches say so; the retention job, as rw_maint, then empties them", async () => {
  const C = await tenant("c"), D = await tenant("d");
  plant.on = true;
  let gone;
  try {
    ({ gone } = await erasureScenario(h, C, D, { ids: ["8301", "8302", "8401"], org: "plant" }));
    await erase(C, gone.id);
  } finally { plant.on = false; }
  assert.deepEqual(shape(await versions(C.tenant)).filter((v) => v.erased), [], "the planted erasure emptied no version");
  assert.deepEqual(await inAnyVersion(GONE), [`${C.tenant} version 4: GONE-RUN-1`, `${C.tenant} version 5: GONE-RUN-2`], "the superuser's search sees the content left");
  assert.deepEqual(await contentLeft(h, C.tenant, GONE), ["fleet_index version 4 bytes: GONE-RUN-1", "fleet_index version 5 bytes: GONE-RUN-2"], "and so does the tenant's: the first test's zero would be refused");
  const stale = await exported(C);
  assert.deepEqual((await contentLeft(h, C.tenant, GONE, stale.bytes)).filter((w) => w.startsWith("archive ")), [], "even then the archive packs no version built from an erased export");

  // the retention job runs as rw_maint: its grant on rw.fleet_index is the erasure and nothing else
  const beforeD = await versions(D.tenant);
  const report = await operator((op) => op.retention());
  const of = (f) => report.find((r) => r.tenant === f.tenant);
  assert.deepEqual([of(C).indexVersions, of(C).failed ?? false, of(D).indexVersions], [3, false, 0], JSON.stringify(report));
  assert.equal(report.some((r) => r.failed), false, JSON.stringify(report));
  assert.deepEqual(await inAnyVersion(GONE), [], "no row of any tenant holds the content after the pass");
  assert.deepEqual(shape(await versions(C.tenant)).filter((v) => v.erased).map((v) => v.version), [3, 4, 5]);
  assert.deepEqual(await versions(D.tenant), beforeD, "the other tenant's versions did not move");
  const entries = await h.store.tx(C.tenant, (tx) => tx.ledgerAll());
  const last = entries[entries.length - 1].body;
  assert.deepEqual([last.who.type, last.what, last.detail], ["operator", "content-erased", { digests: [], indexVersions: [3, 4, 5], reason: "retention" }]);
  assert.equal(verifyChain(entries).ok, true);
  assert.equal(await refusal(h.app.reading.downloadExport(await session(C), stale.id)), "not-found", "an archive prepared before the pass goes with the versions");
  const again = await operator((op) => op.retention());
  assert.deepEqual(again.map((r) => r.indexVersions).filter(Boolean), [], "a second pass erases nothing");
});

test("the database holds a published version to what it is: as rw_app and as rw_maint, the only change accepted is the erasure of its own tenant's bytes", async () => {
  const E = await tenant("e"), F = await tenant("f");
  await erasureScenario(h, E, F, { ids: ["8501", "8502", "8601"], org: "guard" });
  const beforeE = await versions(E.tenant), beforeF = await versions(F.tenant);
  for (const as of ["rw_app", "rw_maint"]) {
    const sql = postgres(urlAs(as), { max: 1, onnotice: () => {} });
    /** One statement as the role, inside the tenant; the transaction is rolled back whatever happens. */
    const attempt = async (t, text) => {
      let result = null;
      await sql.begin(async (q) => {
        await q`select set_config('app.tenant', ${t}, true)`;
        const r = await q.unsafe(text);
        result = `${r.count} row(s)`;
        throw new Error("rollback");
      }).catch((e) => { if (e.message !== "rollback") result = e.message; });
      return result;
    };
    try {
      for (const [text, why] of [
        ["update rw.fleet_index set sha256 = repeat('0', 64) where version = 1", /written once/],
        ["update rw.fleet_index set manifest = '{}'::bytea where version = 1", /written once/],
        ["update rw.fleet_index set seq = seq + 1 where version = 1", /written once/],
        ["update rw.fleet_index set published_at = now() where version = 1", /written once/],
        ["update rw.fleet_index set bytes = '{}'::bytea where version = 1", /written once/],
        ["update rw.fleet_index set bytes = '{}'::bytea, erased_at = now() where version = 1", /written once|fleet_index_erased_holds_no_byte/],
        ["update rw.fleet_index set bytes = ''::bytea where version = 1", /written once/],
        ["update rw.fleet_index set erased_at = now() where version = 1", /fleet_index_erased_holds_no_byte/],
        ["delete from rw.fleet_index where version = 1", /permission denied/],
        ["truncate rw.fleet_index", /permission denied/],
      ]) assert.match(String(await attempt(E.tenant, text)), why, `${as}: ${text}`);
      if (as === "rw_maint") assert.match(String(await attempt(E.tenant, "insert into rw.fleet_index (version, sha256, bytes, manifest_sha256, manifest, fleet_version, fleet_archive_sha256, seq) values (99, 'x', 'x'::bytea, 'x', 'x'::bytea, 'x', 'x', 1)")), /permission denied/, "rw_maint publishes nothing");
      // the erasure itself is accepted for the tenant of the transaction, and reaches no other tenant's row
      assert.equal(await attempt(E.tenant, "update rw.fleet_index set bytes = ''::bytea, erased_at = now() where version = 1"), "1 row(s)", `${as}: the erasure of its own tenant's version`);
      assert.equal(await attempt(E.tenant, "update rw.fleet_index set bytes = ''::bytea, erased_at = now()"), `${beforeE.length} row(s)`, `${as}: an erasure without a predicate stops at the tenant's rows`);
      assert.equal(await attempt(E.tenant, `update rw.fleet_index set bytes = ''::bytea, erased_at = now() where tenant_id = '${F.tenant}'`), "0 row(s)", `${as}: the other tenant's versions are out of reach`);
      assert.equal(await attempt("", "update rw.fleet_index set bytes = ''::bytea, erased_at = now()"), "0 row(s)", `${as}: without a tenant, no row`);
    } finally { await sql.end(); }
  }
  // an erasure is not undone, even by the role that made it
  const sql = postgres(urlAs("rw_app"), { max: 1, onnotice: () => {} });
  try {
    const undone = await sql.begin(async (q) => {
      await q`select set_config('app.tenant', ${E.tenant}, true)`;
      await q`update rw.fleet_index set bytes = ''::bytea, erased_at = now() where version = 1`;
      await q`update rw.fleet_index set erased_at = null where version = 1`;
    }).then(() => "accepted", (e) => e.message);
    assert.match(undone, /written once/);
  } finally { await sql.end(); }
  assert.deepEqual(await versions(E.tenant), beforeE, "every attempt was refused or rolled back: the tenant's versions are what they were");
  assert.deepEqual(await versions(F.tenant), beforeF);
});

// ---------------------------------------------------------------- C21: a transaction in flight during an erasure
// Review finding C21 of 2026-11-10. An erasure that reads the state before it holds the tenant lock does
// not see what a transaction in flight is about to commit, and that transaction does not see the erasure:
// a version built from the erased content is published whole. Each case forces that interleaving on two
// real connections, and looks for the content as the server's superuser.

test("C21: an upload in flight during an erasure commits first; the erasure then empties its version too, and names it", async () => {
  const G = await tenant("g"), H = await tenant("h");
  const { gone } = await erasureScenario(h, G, H, { ids: ["8701", "8702", "8801"], org: "race" });
  await gesture(h, G.session, "content-erase", gone.id);
  // the upload of the tenant's other repository: held when it publishes. It holds the tenant lock and has
  // assembled its version from the current set, which still includes the upload about to be erased
  const u = holdNext((k, a) => k === "insert" && a[0] === "fleet_index");
  const upload = send(h, { repository: "race-a/keep", repository_id: "8701", run_number: "3", run_id: "448701" }, { mission: "race-keep", bytes: markedCheck("KEEP-RUN-3") });
  await u.reached;
  const erasing = h.app.repositories.eraseContent(await session(G), gone.id, {});
  await waitsForTheLock();
  u.release();
  assert.equal((await upload).status, 201, "the upload in flight is accepted");
  const out = await erasing;

  assert.deepEqual(await inVersionsOf(G.tenant, GONE), [], "no version holds the erased content once the erasure answered: not the one the upload published either");
  assert.deepEqual(shape(await versions(G.tenant)), [
    { version: 1, bytes: true, erased: false }, { version: 2, bytes: true, erased: false },
    { version: 3, bytes: false, erased: true }, { version: 4, bytes: false, erased: true }, { version: 5, bytes: false, erased: true },
    { version: 6, bytes: false, erased: true }, { version: 7, bytes: true, erased: false },
  ], "version 6, published by the upload from the content then erased, is emptied; version 7 is the erasure's");
  const entries = await h.store.tx(G.tenant, (tx) => tx.ledgerAll());
  const entry = entries.find((e) => e.seq === out.entry.seq);
  assert.deepEqual([entry.body.what, entry.body.detail.indexVersions, entry.body.detail.indexVersion], ["content-erased", [3, 4, 5, 6], 7], "the entry names every version emptied");
  assert.equal(verifyChain(entries).ok, true);
  assert.deepEqual(await contentLeft(h, G.tenant, GONE), []);
  const served = await h.app.reading.index(G.tenant);
  assert.equal(served.version, 7);
  assert.equal(served.bytes.includes("KEEP-RUN-3") && !GONE.some((m) => served.bytes.includes(m)), true, "the index served carries the upload in flight, and nothing erased");
});

test("C21: an upload of the erased repository itself, in flight during the erasure, is erased with the rest", async () => {
  const I = await tenant("i"), J = await tenant("j");
  const { gone } = await erasureScenario(h, I, J, { ids: ["8711", "8712", "8811"], org: "self" });
  await gesture(h, I.session, "content-erase", gone.id);
  const u = holdNext((k, a) => k === "insert" && a[0] === "fleet_index");
  const upload = send(h, { repository: "self-a/gone", repository_id: "8712", run_number: "4", run_id: "448712" }, { mission: "self-gone", bytes: markedCheck("GONE-RUN-3") });
  await u.reached;
  const erasing = h.app.repositories.eraseContent(await session(I), gone.id, {});
  await waitsForTheLock();
  u.release();
  assert.equal((await upload).status, 201);
  await erasing;
  const markers = [...GONE, "GONE-RUN-3"];
  assert.deepEqual(await inVersionsOf(I.tenant, markers), [], "no version holds the repository's content, the upload in flight included");
  assert.deepEqual(await contentLeft(h, I.tenant, markers), [], "nor an object: the bytes of the upload in flight left with the others");
  assert.deepEqual((await uploadsOf(I.tenant, gone.id)).filter((x) => !x.erased), [], "every upload of the repository is erased");
  assert.deepEqual(shape(await versions(I.tenant)).filter((v) => v.erased).map((v) => v.version), [3, 4, 5, 6]);
});

test("C21: a gesture in flight that republishes does not publish, after the erasure, a version assembled before it", async () => {
  const K = await tenant("k"), L = await tenant("l");
  const { gone } = await erasureScenario(h, K, L, { ids: ["8721", "8722", "8821"], org: "lang" });
  // the language is changed (the index is rebuilt): held at its first request for the tenant lock, which
  // it does not hold yet. The erasure then runs whole.
  await gesture(h, K.session, null, null);
  const g = holdNext((k) => k === "lockTenant");
  const changing = h.app.repositories.settings(await session(K), { lang: "en" }, {});
  await g.reached;
  await gesture(h, K.session, "content-erase", gone.id);
  await h.app.repositories.eraseContent(await session(K), gone.id, {});
  g.release();
  await changing;
  assert.deepEqual(await inVersionsOf(K.tenant, GONE), [], "the version the gesture published after the erasure was assembled after it: it holds nothing erased");
  assert.deepEqual(shape(await versions(K.tenant)), [
    { version: 1, bytes: true, erased: false }, { version: 2, bytes: true, erased: false },
    { version: 3, bytes: false, erased: true }, { version: 4, bytes: false, erased: true }, { version: 5, bytes: false, erased: true },
    { version: 6, bytes: true, erased: false }, { version: 7, bytes: true, erased: false },
  ]);
  const served = await h.app.reading.index(K.tenant);
  assert.equal(served.version, 7, "the gesture's version is the one served");
  assert.equal(JSON.parse(served.bytes.toString("utf8")).missions.length, 2);
  assert.deepEqual(await contentLeft(h, K.tenant, GONE), []);
});

test("C21: a restore in flight at the end of its window commits first; the retention pass, as rw_maint, then erases nothing of a repository that is back", async () => {
  const M = await tenant("m"), N = await tenant("n");
  const { gone } = await erasureScenario(h, M, N, { ids: ["8731", "8732", "8831"], org: "edge" });
  await gesture(h, M.session, null, null);
  await h.app.repositories.remove(await session(M), gone.id, {});
  await gesture(h, M.session, null, null);
  // the removal is dated 30 days ago less a few seconds, by the superuser: the restore is still open now,
  // and the bytes expire while it is in flight
  const MARGIN = 4000;
  const [{ edge }] = await adminDb`update rw.repository set removed_at = now() - interval '30 days' + ${`${MARGIN} milliseconds`}::interval where id = ${gone.id} returning (extract(epoch from removed_at + interval '30 days') * 1000)::bigint as edge`;
  await adminDb`update rw.forge_repository set removed_at = (select removed_at from rw.repository where id = ${gone.id}) where id = ${gone.id}`;
  const r = holdNext((k, a) => k === "insert" && a[0] === "fleet_index");
  const restoring = h.app.repositories.restore(await session(M), gone.id, {});
  await r.reached;
  assert.equal(Date.now() < Number(edge), true, "the restore passed its check inside the window");
  await new Promise((res) => setTimeout(res, Math.max(0, Number(edge) - Date.now()) + 300));
  const pass = operator((op) => op.retention());
  await waitsForTheLock();
  r.release();
  await restoring;
  const report = await pass;
  const mine = report.find((x) => x.tenant === M.tenant);
  assert.deepEqual([mine.failed ?? false, mine.erased, mine.indexVersions], [false, 0, 0], JSON.stringify(mine));
  assert.deepEqual((await uploadsOf(M.tenant, gone.id)).filter((x) => x.erased), [], "the repository is back with its uploads: none is erased");
  const left = await contentLeft(h, M.tenant, GONE);
  assert.ok(left.includes("object sha256: GONE-RUN-2") && left.includes("fleet_index version 7 bytes: GONE-RUN-2"), `its bytes are held, and the version the restore published is built from them: ${JSON.stringify(left)}`);
  assert.deepEqual(shape(await versions(M.tenant)).filter((v) => v.erased), [], "no version was emptied");
  const served = await h.app.reading.index(M.tenant);
  assert.equal(served.version, 7);
  assert.equal(served.bytes.includes(GONE[1]), true, "what is served is built from content that is held");
});

// ---------------------------------------------------------------- C23, C24
test("C23: the erasure's read of the versions returns their number and their fleet.json, for the tenant's versions not yet erased, as rw_app and as rw_maint", async () => {
  const O = await tenant("o"), P = await tenant("p");
  const { gone } = await erasureScenario(h, O, P, { ids: ["8741", "8742", "8841"], org: "narrow" });
  const whole = await versions(O.tenant);
  const read = async (t) => h.store.tx(t, (tx) => tx.indexVersionsWhole());
  for (const as of ["rw_app", "rw_maint"]) {
    role = as;
    try {
      const narrow = await read(O.tenant);
      assert.deepEqual(narrow.map((v) => Object.keys(v).sort()), whole.map(() => ["manifest", "version"]), `${as}: two fields, no byte of the index`);
      assert.deepEqual(narrow.map((v) => [v.version, sha(v.manifest)]), whole.map((v) => [v.version, v.manifest_bytes_sha256]), `${as}: every version, in order, with the fleet.json published`);
      assert.deepEqual((await read(P.tenant)).map((v) => v.version), [1, 2], `${as}: the other tenant reads its own`);
    } finally { role = "rw_app"; }
  }
  await erase(O, gone.id);
  assert.deepEqual((await read(O.tenant)).map((v) => v.version), [1, 2, 6], "an erased version is no longer read");
  // the statement itself: the bytes column is not asked for
  const text = readFileSync(new URL("../../src/adapters/store/postgres.js", import.meta.url), "utf8");
  assert.match(text, /select version, manifest from rw\.fleet_index where erased_at is null order by version/);
});

test("C24: the database dates an erasure itself: as rw_app and as rw_maint, a date in the past or at infinity is replaced by the transaction's", async () => {
  const Q = await tenant("q"), R = await tenant("r");
  await erasureScenario(h, Q, R, { ids: ["8751", "8752", "8851"], org: "date" });
  const before = await versions(Q.tenant);
  for (const as of ["rw_app", "rw_maint"]) {
    const sql = postgres(urlAs(as), { max: 1, onnotice: () => {} });
    try {
      for (const given of ["1970-01-01", "infinity", "-infinity", "2999-12-31"]) {
        let seen = null;
        await sql.begin(async (q) => {
          await q`select set_config('app.tenant', ${Q.tenant}, true)`;
          seen = await q.unsafe(`update rw.fleet_index set bytes = ''::bytea, erased_at = '${given}' where version = 1 returning erased_at = now() as current, isfinite(erased_at) as finite`);
          throw new Error("rollback");
        }).catch((e) => { if (e.message !== "rollback") throw e; });
        assert.deepEqual(seen.map((x) => ({ ...x })), [{ current: true, finite: true }], `${as}: an erasure dated ${given} is dated by the database`);
      }
    } finally { await sql.end(); }
  }
  assert.deepEqual(await versions(Q.tenant), before, "every attempt was rolled back");
});
