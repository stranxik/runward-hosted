// PADR-0013 point 5, against a real PostgreSQL: two real tenants made through the application under rw_app,
// then the isolation suite (0 row read or written outside its tenant, the resolution functions included),
// the catalog checks, and the planted controls that must make the suite fail. Also: the journal is append
// only for the service, a link's dates are the database's, and the application's paths run on PostgreSQL.
// Needs PG_ADMIN_URL (a superuser of a throwaway server). Run on the NAS, never against a real base.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { migrate } from "../../scripts/migrate.mjs";
import { postgresStore } from "../../src/adapters/store/postgres.js";
import { harness, founder, pinnedRepository, send, gesture, sha, token, claimsFor } from "../helpers.js";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { replay, replayPin } from "../../scripts/replay-export.mjs";

const ADMIN = process.env.PG_ADMIN_URL;
if (!ADMIN) { test("PG_ADMIN_URL is set", () => assert.fail("PG_ADMIN_URL is required: this suite never skips silently")); }
const DB = `rw_test_${randomBytes(4).toString("hex")}`;
const urlAs = (role) => { const u = new URL(ADMIN); u.username = role; u.password = ""; u.pathname = `/${DB}`; return u.toString(); };
let admin, adminDb, store, h, A, B, firstRun;
const MIGRATIONS = readdirSync(new URL("../../db/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
const SNAPSHOT = new URL("../../db/schema.snapshot.txt", import.meta.url).pathname;
const TENANT_TABLES = ["member", "passkey", "session", "link", "forge_repository", "repository", "mission", "upload", "blob", "fleet_index", "reader", "archive", "ledger", "issuer", "issuer_key"];

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
  firstRun = await migrate(urlAs("rw_owner"), { log: () => {} });
  store = postgresStore({ url: urlAs("rw_app"), ssl: false });
  const u = new URL(ADMIN); u.pathname = `/${DB}`;
  adminDb = postgres(u.toString(), { max: 1, onnotice: () => {} });
  h = harness({ store, realTime: true });
});
after(async () => {
  if (!ADMIN) return;
  await store?.close();
  await adminDb?.end();
  await admin.unsafe(`drop database if exists ${DB} with (force)`);
  await admin.end();
});

test("the migration is idempotent: a second run applies nothing", async () => {
  assert.deepEqual(firstRun.applied, MIGRATIONS, "the first run applied every committed migration, in order");
  const lines = [];
  const second = await migrate(urlAs("rw_owner"), { log: (l) => lines.push(l) });
  assert.deepEqual(second.applied, [], "the second run applied no migration");
  assert.deepEqual(lines, ["migrate: grants applied"], "it only re-applied the grants, which are idempotent");
  const recorded = await adminDb`select name from rw_meta.migration order by name`;
  assert.deepEqual(recorded.map((r) => r.name), MIGRATIONS, "each migration recorded once");
});

test("two real tenants, made through the application under rw_app", async () => {
  // rw_app cannot open a tenant: that is the operator's gesture, under rw_maint
  const maint = postgresStore({ url: urlAs("rw_maint"), ssl: false });
  const hm = harness({ store: maint, realTime: true });
  const ta = randomBytes(32).toString("base64url"), tb = randomBytes(32).toString("base64url");
  const a = await hm.app.operator.openBootstrap({ hash: sha(Buffer.from(ta)) });
  const b = await hm.app.operator.openBootstrap({ hash: sha(Buffer.from(tb)) });
  await maint.close();
  A = await founder(h, { prefix: "a", token: ta, tenant: a.tenant });
  B = await founder(h, { prefix: "b", token: tb, tenant: b.tenant });
  await pinnedRepository(h, A, { name: "org-a/repo", mission: "mission-a", claims: { repository_id: "5001" } });
  await pinnedRepository(h, B, { name: "org-b/repo", mission: "mission-b", claims: { repository_id: "5002", run_id: "39000000002" } });
  const r = await send(h, { repository: "org-a/repo", repository_id: "5001", run_number: "3", run_id: "40000000003" }, { mission: "mission-a" });
  assert.equal(r.status, 201);
});

/** The isolation suite: from each tenant, read and write every table; count what belongs to the other. */
async function isolationFaults(sql, tables, me, other) {
  const faults = [];
  for (const t of tables) {
    await sql.begin(async (q) => {
      await q`select set_config('app.tenant', ${me}, true)`;
      const col = t === "tenant" ? "id" : "tenant_id";
      const [{ n }] = await q.unsafe(`select count(*)::int as n from rw.${t} where ${col} = $1`, [other]);
      if (n) faults.push(`${t}: ${n} row(s) of the other tenant read`);
      const [{ m }] = await q.unsafe(`select count(*)::int as m from rw.${t}`);
      const [{ mine }] = await q.unsafe(`select count(*)::int as mine from rw.${t} where ${col} = $1`, [me]);
      if (m !== mine) faults.push(`${t}: ${m - mine} row(s) outside the tenant visible`);
      if (t !== "ledger" && t !== "tenant") {
        const up = await q.unsafe(`update rw.${t} set tenant_id = tenant_id where tenant_id = $1`, [other]).catch((e) => ({ count: 0, e }));
        if (up.count) faults.push(`${t}: ${up.count} row(s) of the other tenant updated`);
      }
    }).catch((e) => faults.push(`${t}: ${e.message}`));
  }
  // a write that names the other tenant is refused by WITH CHECK
  await sql.begin(async (q) => {
    await q`select set_config('app.tenant', ${me}, true)`;
    await q`insert into rw.reader (tenant_id, authorized_at) values (${other}, now())`;
    faults.push("reader: a row was written for the other tenant");
  }).catch((e) => { if (!/row-level security|violates/.test(e.message)) faults.push(`unexpected: ${e.message}`); });
  return faults;
}

test("S4: 0 row read or written outside its tenant, both ways, as rw_app", async () => {
  const sql = postgres(urlAs("rw_app"), { max: 1, onnotice: () => {} });
  try {
    assert.deepEqual(await isolationFaults(sql, [...TENANT_TABLES, "tenant"], A.tenant, B.tenant), []);
    assert.deepEqual(await isolationFaults(sql, [...TENANT_TABLES, "tenant"], B.tenant, A.tenant), []);
    // with no tenant set, nothing is visible at all
    for (const t of TENANT_TABLES) { const [{ n }] = await sql.unsafe(`select count(*)::int as n from rw.${t}`); assert.equal(n, 0, t); }
    // the service has no direct access to the tables without a tenant
    for (const t of ["webauthn_challenge", "oidc_jti", "rate_counter", "refused_counter", "operator_journal", "service_state", "token_use", "send_rate", "send_refused"]) await assert.rejects(sql.unsafe(`select * from rw.${t}`), /permission denied/, t);
  } finally { await sql.end(); }
});

test("the resolution functions answer by exact key, one answer for absent and elsewhere", async () => {
  await h.store.tx(A.tenant, async (tx) => {
    assert.equal(await tx.nameTaken({ forge: "github", nameKey: "org-a/repo" }), "here");
    assert.equal(await tx.nameTaken({ forge: "github", nameKey: "org-b/repo" }), "elsewhere");
    assert.equal(await tx.nameTaken({ forge: "github", nameKey: "nobody/none" }), "free");
  });
  const unknown = await h.store.tx(null, (tx) => tx.resolveRepository({ forge: "github", repositoryId: "999999", nameKey: "nobody/none" }));
  assert.equal(unknown, null);
  const b = await h.store.tx(null, (tx) => tx.resolveRepository({ forge: "github", repositoryId: "5002", nameKey: "org-b/repo" }));
  assert.equal(b.tenantId, B.tenant);
  // an upload from B's repository, seen from A's session, never lands in A
  const res = await send(h, { repository: "org-b/repo", repository_id: "5002", run_number: "4", run_id: "40000000004" }, { mission: "mission-b" });
  assert.equal(res.status, 201);
  const aEntries = await h.store.tx(A.tenant, (tx) => tx.ledgerAll());
  assert.equal(aEntries.some((e) => JSON.stringify(e.body).includes("org-b")), false);
  // the application refuses a cross-tenant read by session
  assert.equal((await h.app.reading.index(B.tenant)).sha256 !== (await h.app.reading.index(A.tenant)).sha256, true);
});

test("catalog: forced RLS on every tenant table, rw_app without bypass, no USING (true), the exact definer list", async () => {
  const rows = await adminDb.unsafe(`select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'rw' and c.relkind = 'r'`);
  const by = Object.fromEntries(rows.map((r) => [r.relname, r]));
  for (const t of [...TENANT_TABLES, "tenant"]) { assert.equal(by[t]?.relrowsecurity, true, t); assert.equal(by[t]?.relforcerowsecurity, true, t); }
  const [{ rolbypassrls, rolsuper }] = await adminDb`select rolbypassrls, rolsuper from pg_roles where rolname = 'rw_app'`;
  assert.equal(rolbypassrls, false); assert.equal(rolsuper, false);
  const open = await adminDb`select polname from pg_policy where pg_get_expr(polqual, polrelid) ~* '^\\(?\\s*true\\s*\\)?$'`;
  assert.deepEqual([...open], []);
  const views = await adminDb`select viewname from pg_views where schemaname = 'rw'`;
  assert.deepEqual([...views], [], "no view (a view without security_invoker would bypass RLS)");
  const defs = (await adminDb`select p.proname, pg_get_userbyid(p.proowner) as owner from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'rw' and p.prosecdef order by 1`).map((r) => `${r.proname}:${r.owner}`);
  assert.deepEqual(defs, ["count_refused", "count_send_refused", "daily_jobs", "maintenance", "name_key_taken", "name_taken", "operator_note", "put_challenge", "resolve_credential", "resolve_forge_repository", "resolve_issuer", "resolve_link", "resolve_repository", "resolve_session", "set_maintenance", "take_challenge", "take_rate", "take_send_rate", "tenant_ids", "use_jti", "use_token"].map((f) => `${f}:rw_resolve`));
  const owners = await adminDb`select distinct tableowner from pg_tables where schemaname = 'rw'`;
  assert.deepEqual(owners.map((r) => r.tableowner), ["rw_owner"], "the service owns nothing");
});

test("planted controls: a twin table without RLS, or with USING (true), makes the suite fail", async () => {
  const owner = postgres(urlAs("rw_owner"), { max: 1, onnotice: () => {} });
  try {
    await owner.unsafe("create table rw.planted_open (tenant_id uuid not null, x int); grant select, update on rw.planted_open to rw_app");
    await owner.unsafe("create table rw.planted_true (tenant_id uuid not null, x int); alter table rw.planted_true enable row level security; alter table rw.planted_true force row level security; create policy p on rw.planted_true using (true); grant select, update on rw.planted_true to rw_app");
    await owner`insert into rw.planted_open values (${B.tenant}, 1)`;
    await owner`insert into rw.planted_true values (${B.tenant}, 1)`;
    const sql = postgres(urlAs("rw_app"), { max: 1, onnotice: () => {} });
    try {
      const f = await isolationFaults(sql, ["planted_open", "planted_true"], A.tenant, B.tenant);
      assert.ok(f.some((x) => x.startsWith("planted_open")), "RLS disabled is seen");
      assert.ok(f.some((x) => x.startsWith("planted_true")), "USING (true) is seen");
    } finally { await sql.end(); }
    const open = await adminDb`select polname from pg_policy where pg_get_expr(polqual, polrelid) ~* '^\\(?\\s*true\\s*\\)?$'`;
    assert.equal(open.length, 1, "the catalog check sees the planted policy");
  } finally {
    await owner.unsafe("drop table rw.planted_open; drop table rw.planted_true");
    await owner.end();
  }
});

test("the journal is append only for the service; truncate is refused even to the owner's trigger", async () => {
  const sql = postgres(urlAs("rw_app"), { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (q) => {
      await q`select set_config('app.tenant', ${A.tenant}, true)`;
      await assert.rejects(q`update rw.ledger set hash = 'x'`, /permission denied/);
    }).catch(() => {});
    await sql.begin(async (q) => { await q`select set_config('app.tenant', ${A.tenant}, true)`; await assert.rejects(q`delete from rw.ledger`, /permission denied/); }).catch(() => {});
    await assert.rejects(sql`truncate rw.ledger`, /permission denied/);
  } finally { await sql.end(); }
  const owner = postgres(urlAs("rw_owner"), { max: 1, onnotice: () => {} });
  try {
    await owner.begin(async (q) => {
      await q`select set_config('app.tenant', ${A.tenant}, true)`;
      await assert.rejects(q`update rw.ledger set hash = 'x'`, /append only/);
    }).catch((e) => { if (!/append only/.test(e.message)) throw e; });
    await owner.begin(async (q) => { await q`select set_config('app.tenant', ${A.tenant}, true)`; await assert.rejects(q`delete from rw.ledger`, /append only/); }).catch((e) => { if (!/append only/.test(e.message)) throw e; });
    await assert.rejects(owner`truncate rw.ledger`, /append only/);
  } finally { await owner.end(); }
});

test("jsonb columns hold objects, never a JSON string (guard on a defect found here)", async () => {
  await adminDb`select 1`;
  const kinds = await adminDb.unsafe(`select distinct jsonb_typeof(body) as k from rw.ledger union select distinct jsonb_typeof(claims) from rw.upload union select distinct jsonb_typeof(transports) from rw.passkey`);
  assert.deepEqual(kinds.map((r) => r.k).sort(), ["array", "object"]);
});

test("a link's dates are written by the database, never by its caller", async () => {
  const sql = postgres(urlAs("rw_maint"), { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (q) => {
      await q`select set_config('app.tenant', ${A.tenant}, true)`;
      const [l] = await q`insert into rw.link (id, token_hash, kind, member_id, usable_from, expires_at) values (gen_random_uuid(), ${randomBytes(32).toString("hex")}, 'recovery', ${A.session.memberId}, now() - interval '1 day', now() + interval '1 day') returning opened_at, usable_from, expires_at`;
      assert.equal(new Date(l.usable_from) - new Date(l.opened_at), 24 * 3600 * 1000, "the delay cannot be shortened");
      assert.equal(new Date(l.expires_at) - new Date(l.usable_from), 24 * 3600 * 1000);
      await assert.rejects(q`update rw.link set usable_from = now() where token_hash is not null`, /written once/);
    }).catch((e) => { if (!/written once/.test(e.message)) throw e; });
  } finally { await sql.end(); }
});

test("the application on PostgreSQL: history, quarantine, removal and restore, export and replay", async () => {
  const s = await h.app.identity.sessionFrom(A.token);
  const hist = await send(h, { repository: "org-a/repo", repository_id: "5001", run_number: "2", run_id: "40000000002" }, { mission: "mission-a" });
  assert.equal(hist.body.current, false);
  const repos = await h.store.tx(A.tenant, (tx) => tx.list("repository"));
  await gesture(h, s, null, null);
  await h.app.repositories.remove(await h.app.identity.sessionFrom(A.token), repos[0].id, {});
  assert.equal((await send(h, { repository: "org-a/repo", repository_id: "5001", run_number: "5", run_id: "40000000005" }, { mission: "mission-a" })).refusal, "repository-not-declared");
  await gesture(h, s, null, null);
  await h.app.repositories.restore(await h.app.identity.sessionFrom(A.token), repos[0].id, {});
  await gesture(h, s, "export", "");
  const a = await h.app.reading.prepareExport(await h.app.identity.sessionFrom(A.token), {});
  const pin = replayPin();
  const r = replay(a.bytes, pin.version, pin.archives);
  assert.equal(r.ok, true, JSON.stringify(r.results));
  const { verifyChain } = await import("../../src/domain/ledger.js");
  const all = await h.store.tx(A.tenant, (tx) => tx.ledgerAll());
  const v = verifyChain(all);
  assert.equal(v.ok, true, v.ok ? "" : `${v.why} at ${v.at}: ${JSON.stringify(all.find((e) => e.seq === v.at))}`);
  assert.equal(r.chainOk, true);
  const chains = await (async () => { const maint = postgresStore({ url: urlAs("rw_maint"), ssl: false }); const hm = harness({ store: maint, realTime: true }); const v = await hm.app.operator.verifyChains(); await maint.close(); return v; })();
  assert.ok(chains.length >= 2 && chains.every((c) => c.ok), JSON.stringify(chains));
});

test("two instances on one PostgreSQL share every state: a session, a challenge, a token already used", async () => {
  // scaling-state-externalization: nothing a request needs lives in an instance's memory
  const other = postgresStore({ url: urlAs("rw_app"), ssl: false });
  try {
    const h2 = harness({ store: other, realTime: true });
    const s1 = await h.app.identity.sessionFrom(A.token);
    const s2 = await h2.app.identity.sessionFrom(A.token);
    assert.equal(s2?.id, s1.id, "a session opened on one instance is read on the other");
    const cred = (await h.store.tx(s1.tenantId, (tx) => tx.get("passkey", { id: s1.passkeyId }))).credentialId;
    const o = await h.app.identity.freshOptions(s1, {});
    await h2.app.identity.fresh(s2, { challengeId: o.challengeId, response: { id: cred, challenge: o.options.challenge } });
    await assert.rejects(h.app.identity.fresh(s1, { challengeId: o.challengeId, response: { id: cred, challenge: o.options.challenge } }), (e) => e.code === "challenge-invalid", "consumed on the other instance, so single use across both");
    const t = token(claimsFor(h.clock, { repository: "org-a/repo", repository_id: "5001", run_number: "7", run_id: "40000000007" }));
    const first = await send(h, {}, { mission: "mission-a", auth: `Bearer ${t}` });
    assert.equal(first.status, 201);
    assert.equal((await send(h2, {}, { mission: "mission-a", auth: `Bearer ${t}` })).refusal, "token-replayed", "a token used on one instance is refused on the other");
  } finally { await other.close(); }
});

// ADR-0017: every statement has a deadline, each bound with a test (review finding of 2026-11-10: this one
// had none). Read on a connection the store itself opened; the control, a bare connection to the same
// server, reads the server's default, so the check tells the two apart.
test("every statement has a deadline: the store's connections read statement_timeout 10s, a bare connection the server's 0 (control)", async () => {
  const [{ statement_timeout: store }] = await h.store.sql`show statement_timeout`;
  assert.equal(store, "10s");
  const bare = postgres(urlAs("rw_app"), { max: 1, onnotice: () => {} });
  try {
    const [{ statement_timeout: plain }] = await bare`show statement_timeout`;
    assert.equal(plain, "0", "without the store's setting, a statement has no deadline");
  } finally { await bare.end(); }
});

// Review finding of 2026-11-10: a failed daily job was noted in the operator journal, which rw_app cannot
// read and nothing else read. rw.daily_jobs() gives the service the last outcome of each job, nothing more.
test("the daily jobs' last outcome is read by the service (rw_app) through rw.daily_jobs(), without a tenant, an error or a head", async () => {
  const note = async (what, detail) => {
    const maint = postgresStore({ url: urlAs("rw_maint"), ssl: false });
    try { await maint.tx(null, (tx) => tx.operatorNote(what, detail)); } finally { await maint.close(); }
  };
  await note("retention", { report: [{ tenant: A.tenant, failed: true, error: `planted failure in ${B.tenant}`, attempts: 3 }], failed: 1 });
  await note("verify-chains", { report: [{ tenant: A.tenant, ok: false, head: "f".repeat(64), at: 3, why: "hash" }], failed: 0 });
  const j = await h.store.tx(null, (tx) => tx.dailyJobs());
  assert.deepEqual(Object.keys(j).sort(), ["retention", "verify-chains"]);
  assert.deepEqual([j.retention.ok, j["verify-chains"].ok], [false, false], "a failed tenant and a broken chain are both a run that did not complete");
  assert.ok(Number.isFinite(j.retention.at));
  const sql = postgres(urlAs("rw_app"), { max: 1, onnotice: () => {} });
  try {
    const [{ t }] = await sql`select rw.daily_jobs()::text as t`;
    for (const s of [A.tenant, B.tenant, "f".repeat(64), "planted"]) assert.equal(t.includes(s), false, `${s} reached the service`);
  } finally { await sql.end(); }
  await note("retention", { report: [{ tenant: A.tenant, erased: 0, archives: 0, expired: 0, attempts: 1 }], failed: 0 });
  assert.equal((await h.store.tx(null, (tx) => tx.dailyJobs())).retention.ok, true, "the latest run is the one read");
});

// Review finding of 2026-11-10 (code review C4): rw.daily_jobs() evaluated its `ok` on every retained note of
// both jobs, not on the two it keeps, on each call of the public /api/health: 365 days of 1,000 tenants took
// 1.5 s a call, on the way to the 10 s statement deadline. It reads the last note of each job by an index.
test("rw.daily_jobs() evaluates the last note of each job and no other, found through its index", async () => {
  const maint = postgresStore({ url: urlAs("rw_maint"), ssl: false });
  try {
    // an older note that cannot be evaluated at all: a function that reads every note fails on it
    await maint.tx(null, (tx) => tx.operatorNote("retention", { failed: "not a number", report: [] }));
    for (let day = 0; day < 40; day++) await maint.tx(null, (tx) => tx.operatorNote("retention", { failed: 0, report: Array.from({ length: 25 }, () => ({ erased: 0, attempts: 1 })) }));
  } finally { await maint.close(); }
  const j = await h.store.tx(null, (tx) => tx.dailyJobs());
  assert.equal(j.retention.ok, true, "the last note is the one evaluated");
  const [index] = await adminDb`select indexdef from pg_indexes where schemaname = 'rw' and indexname = 'operator_journal_what_seq'`;
  assert.match(index?.indexdef ?? "", /\(what, seq DESC\)/);
  // the read the function makes for each job is served by that index, not by a scan of the journal
  const plan = await adminDb.begin(async (q) => {
    await q.unsafe("set local enable_seqscan = off");
    return q.unsafe("explain (format json) select o.what, o.at, o.detail from rw.operator_journal o where o.what = 'retention' order by o.seq desc limit 1");
  });
  assert.match(JSON.stringify(plan), /operator_journal_what_seq/);
  // control: the unreadable note is still there, and reading every note fails on it, as the function did
  await assert.rejects(adminDb.unsafe("select (detail ->> 'failed')::integer from rw.operator_journal where what = 'retention'"), /invalid input syntax for type integer/);
});

// Review finding of 2026-11-10 (code review C1, blocking): rw.daily_jobs() named the type jsonb without its
// schema under `search_path = rw, pg_catalog`. PostgreSQL searches pg_temp first for a type unless the path
// names it, so a session as rw_app planted pg_temp.jsonb, a domain whose check calls its own function, and
// that function ran as rw_resolve, which reads tenants, sessions, passkeys and links across tenants.
test("a security definer function resolves no name in the caller's temporary schema: a planted pg_temp.jsonb never runs as rw_resolve", async () => {
  // the worst case: the service's role may create temporary objects in this database
  await adminDb.unsafe(`grant temporary on database ${DB} to rw_app`);
  // the last note of each job carries no report, so the function's body evaluates its typed constant (the
  // `else '[]'::jsonb` of its case): the place where a shadowed type would run
  const maint = postgresStore({ url: urlAs("rw_maint"), ssl: false });
  try { for (const job of ["retention", "verify-chains"]) await maint.tx(null, (tx) => tx.operatorNote(job, { failed: 0 })); } finally { await maint.close(); }
  const notices = [];
  const sql = postgres(urlAs("rw_app"), { max: 1, onnotice: (n) => notices.push(n.message) });
  try {
    await sql.unsafe("create function pg_temp.spy(pg_catalog.jsonb) returns boolean language plpgsql as $$ begin raise notice 'spy runs as % (session %)', current_user, session_user; return true; end $$");
    await sql.unsafe("create domain pg_temp.jsonb as pg_catalog.jsonb check (pg_temp.spy(value))");
    // control: the plant is live. In the caller's own statement the temporary type is found first, and its
    // check runs, as the caller
    await sql.unsafe("select '{}'::jsonb as j");
    assert.deepEqual(notices, ["spy runs as rw_app (session rw_app)"], "the planted type shadows jsonb for its own session");
    notices.length = 0;
    const [{ j }] = await sql.unsafe("select rw.daily_jobs() as j");
    assert.deepEqual([j.retention.ok, j["verify-chains"].ok], [true, true], "the function answered, from the two notes without a report");
    assert.deepEqual(notices, [], "the planted type ran inside rw.daily_jobs()");
    // the other functions the service may call, with the plant in place
    await sql.unsafe("select rw.maintenance(), rw.name_taken('github', 'nobody/none'), rw.count_refused('planted', 1)");
    await sql.unsafe("select * from rw.resolve_session('none'), rw.resolve_link('none'), rw.resolve_credential('none')");
    assert.deepEqual(notices, []);
  } finally {
    await sql.end();
    await adminDb.unsafe(`revoke temporary on database ${DB} from rw_app`);
  }
});

// The second net of C1: scripts/roles.mjs, the administrator's gesture, takes TEMPORARY on the service
// database away from PUBLIC, so the service's role cannot create the temporary type at all.
test("the roles gesture takes temporary objects away from the service's roles, and says whether it could", async () => {
  process.env.RW_DATABASE = DB;
  const { roles } = await import("../../scripts/roles.mjs");
  const tryTemp = async (role) => {
    const sql = postgres(urlAs(role), { max: 1, onnotice: () => {} });
    try { await sql.unsafe("create temporary table planted_temp (x int)"); return "created"; } catch (e) { return e.message; } finally { await sql.end(); }
  };
  assert.equal(await tryTemp("rw_app"), "created", "control: before the gesture, PUBLIC may create temporary objects");
  const u = new URL(ADMIN); u.pathname = `/${DB}`;
  const lines = [];
  assert.deepEqual(await roles(u.toString(), { log: (l) => lines.push(l) }), { temporaryRevoked: true });
  assert.match(lines.join(), /no temporary objects for rw_app and rw_maint/);
  for (const role of ["rw_app", "rw_maint"]) assert.match(await tryTemp(role), /permission denied to create temporary tables/, role);
  // an administrator that may manage the roles but does not own the database, as a hoster's may be: its
  // revoke is a warning, the same line says so, and the gesture does not fail
  await adminDb.unsafe(`grant temporary on database ${DB} to public`);
  const stand = `rw_test_admin_${randomBytes(4).toString("hex")}`;
  await adminDb.unsafe(`create role ${stand} login createrole; grant rw_resolve to ${stand} with admin option; grant connect on database ${DB} to ${stand}`);
  try {
    const said = [];
    const r = await roles(urlAs(stand), { log: (l) => said.push(l) }).catch((e) => ({ error: e.message }));
    assert.deepEqual(r, { temporaryRevoked: false }, JSON.stringify(r));
    assert.match(said.join(), /TEMPORARY NOT revoked/);
    assert.equal(await tryTemp("rw_app"), "created");
  } finally {
    await adminDb.unsafe(`revoke rw_resolve from rw_owner granted by ${stand}`).catch(() => {});
    await adminDb.unsafe(`drop owned by ${stand}; drop role ${stand}`);
    await adminDb.unsafe(`revoke temporary on database ${DB} from public`);
  }
});

// C28 (review of 2026-11-10): the level of rw_app and rw_maint at the hoster is ignored by OpenTofu after
// creation, so nothing showed a right added to them by another hand. The gesture `grants`, run after
// `migrate` at each deploy, compares what the two roles may do IN EFFECT with the grant lines of the
// committed snapshot. It runs as rw_owner (scripts/grants.mjs), here as at the hoster: a role that is no
// superuser, on its own URL, which names the service database. Each planted drift must be refused, named,
// and the base left as it was.
test("the grants gesture, as rw_owner, refuses a base whose grants for rw_app or rw_maint are not the snapshot's", async () => {
  process.env.RW_DATABASE = DB;
  const { grants, expectedGrants } = await import("../../scripts/grants.mjs");
  const { roles } = await import("../../scripts/roles.mjs");
  const [owner] = await adminDb`select rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname = 'rw_owner'`;
  assert.deepEqual({ ...owner }, { rolsuper: false, rolbypassrls: false, rolcreaterole: false }, "the comparison is read by a plain role, as at the hoster");
  const run = () => grants(urlAs("rw_owner"), { log: () => {} }).then((r) => r, (e) => ({ error: e.message }));
  const committed = readFileSync(SNAPSHOT, "utf8");
  const sound = await run();
  assert.equal(sound.error, undefined, sound.error);
  assert.deepEqual(sound, { grants: expectedGrants(committed).length }, "it compared every grant line of the two roles");
  assert.ok(sound.grants > 60, "table, schema and database lines for both roles");
  const lines = [];
  await grants(urlAs("rw_owner"), { log: (l) => lines.push(l) });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith(`grants: the ${sound.grants} table, schema and database grants of rw_app and rw_maint are those of db/schema.snapshot.txt, no more, no fewer (read in the database ${DB})`), lines[0]);
  const planted = [
    ["a DELETE for the service", "grant delete on rw.upload to rw_app", "revoke delete on rw.upload from rw_app", /1 more than the snapshot \(rw\.upload rw_app DELETE\)/],
    ["the journal made updatable", "grant update on rw.ledger to rw_maint", "revoke update on rw.ledger from rw_maint", /1 more than the snapshot \(rw\.ledger rw_maint UPDATE\)/],
    ["a right given to everyone", "grant truncate on rw.blob to public", "revoke truncate on rw.blob from public", /2 more than the snapshot \(rw\.blob rw_app TRUNCATE, rw\.blob rw_maint TRUNCATE\)/],
    ["a right on one column", "grant update (title) on rw.tenant to rw_maint", "revoke update (title) on rw.tenant from rw_maint", /1 more than the snapshot \(rw\.tenant rw_maint UPDATE\)/],
    ["a right on the migrations' table", "grant usage on schema rw_meta to rw_app; grant select on rw_meta.migration to rw_app", "revoke select on rw_meta.migration from rw_app; revoke usage on schema rw_meta from rw_app", /2 more than the snapshot \(rw_meta\.migration rw_app SELECT, schema rw_meta rw_app USAGE\)/],
    ["CREATE on the schema", "grant create on schema rw to rw_app", "revoke create on schema rw from rw_app", /1 more than the snapshot \(schema rw rw_app CREATE\)/],
    ["CREATE on the database", `grant create on database ${DB} to rw_maint`, `revoke create on database ${DB} from rw_maint`, /1 more than the snapshot \(database rw_maint CREATE\)/],
    ["a right through a membership", "grant rw_owner to rw_app", "revoke rw_owner from rw_app", /more than the snapshot \(.*rw_app DELETE/],
    ["a grant of db/grants.sql gone", "revoke select on rw.reader from rw_maint", "grant select on rw.reader to rw_maint", /1 fewer \(rw\.reader rw_maint SELECT\)/],
  ];
  for (const [what, plant, undo, said] of planted) {
    await adminDb.unsafe(plant);
    try {
      const r = await run();
      assert.match(r.error ?? "(no refusal)", /^the grants of rw_app and rw_maint are not those of db\/schema\.snapshot\.txt: /, what);
      assert.match(r.error, said, what);
      assert.equal(r.error.includes("\n"), false, "one line: the gateway keeps the last line of a failed gesture");
      assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-/.test(r.error), false, "no identifier of a row");
    } finally { await adminDb.unsafe(undo); }
  }
  assert.equal((await run()).error, undefined, "the base is as it was");
  // a snapshot that cannot stand as the reference is a refusal, never a pass
  const without = (re) => committed.split("\n").filter((l) => !re.test(l)).join("\n");
  for (const [what, text] of [["no table line for rw_maint", without(/^grant rw\.\S+ rw_maint /)], ["no schema line", without(/^grant schema /)], ["no database line", without(/^grant database /)], ["empty", ""]]) {
    const r = await grants(urlAs("rw_owner"), { log: () => {}, snapshot: text }).then(() => ({}), (e) => ({ error: e.message }));
    assert.match(r.error ?? "(no refusal)", /holds no (table|schema|database) grant line for rw_(app|maint)/, what);
  }
  // the administrator's gesture compares nothing (it runs before `migrate`, on a base that may be behind),
  // and the option it had until 2026-11-11 is refused, never ignored
  const u = new URL(ADMIN); u.pathname = `/${DB}`;
  await adminDb.unsafe("grant delete on rw.upload to rw_app");
  try {
    assert.deepEqual(await roles(u.toString(), { log: () => {} }), { temporaryRevoked: true });
    await assert.rejects(roles(u.toString(), { log: () => {}, grants: true }), /roles takes no option grants/);
  } finally { await adminDb.unsafe("revoke delete on rw.upload from rw_app"); }
});

// Two deploys stopped on the comparison on 2026-11-11, when it was a flag of the administrator's gesture.
// Run 42930736032: the administrator's URL names the hoster's default database (`rdb`), and the comparison
// read the tables and schemas of the database it was connected to: none, so every table and schema line
// was "fewer". Run 43018993884: given a session of its own on the service database, the administrator was
// refused by the server, "permission denied for database": at the hoster a user connects only where it
// holds a privilege, and rw_admin holds none on the service database. The production shape, here: another,
// empty database of the same server, and an administrator that may connect there and not to the service's.
test("the grants are compared in the service database only, by rw_owner; the administrator needs no access to it", async () => {
  process.env.RW_DATABASE = DB;
  const { grants, expectedGrants, effectiveGrants, compareGrants } = await import("../../scripts/grants.mjs");
  const { roles } = await import("../../scripts/roles.mjs");
  const other = `rw_test_rdb_${randomBytes(4).toString("hex")}`;
  await admin.unsafe(`create database ${other}`);
  const elsewhere = (user) => { const u = new URL(ADMIN); if (user) { u.username = user; u.password = ""; } u.pathname = `/${other}`; return u.toString(); };
  const run = (url = urlAs("rw_owner")) => grants(url, { log: () => {} }).then((r) => r, (e) => ({ error: e.message }));
  const committed = readFileSync(SNAPSHOT, "utf8");
  const expected = expectedGrants(committed);
  const NOT_HERE = /nothing compared, refused \(the comparison reads the service database \S+ and no other\)$/;
  try {
    const ownerElsewhere = postgres(elsewhere("rw_owner"), { max: 1, onnotice: () => {} });
    try {
      // the control: what an unguarded read finds in the other database, which rw_owner can reach. No table
      // and no schema of the service: every such line of the snapshot would be "fewer" (68 on 2026-11-11),
      // the line production wrote
      const [{ n, db }] = await ownerElsewhere`select count(*)::int as n, current_database() as db from pg_namespace where nspname in ('rw', 'rw_meta')`;
      assert.deepEqual({ n, db }, { n: 0, db: other }, "rw_owner is connected to the other database, which holds no schema of the service");
      const read = await effectiveGrants(ownerElsewhere);
      const notDatabase = expected.filter((l) => !l.startsWith("grant database "));
      assert.ok(notDatabase.length >= 68 && notDatabase.length < expected.length, "table and schema lines, and database lines beside them");
      assert.deepEqual(read.sort(), expected.filter((l) => l.startsWith("grant database ")).sort(), "read there: the database lines (asked by name), and not one table or schema line");
      // the comparison, on that same session: refused for where it is, before the catalog is read, never a count
      const there = await compareGrants(ownerElsewhere, committed).then(() => "(no refusal)", (e) => e.message);
      assert.match(there, new RegExp(`^the session meant for the service database ${DB} is on another one: nothing compared, refused`));
      assert.match(there, NOT_HERE);
      assert.equal(/fewer|more than/.test(there), false, "no count of grants");
    } finally { await ownerElsewhere.end(); }
    // the gesture, given a URL that names the other database (rw_owner's, or the administrator's as the
    // hoster has it): refused, in one line, never a count
    for (const url of [elsewhere("rw_owner"), elsewhere()]) {
      const r = await run(url);
      assert.match(r.error ?? "(no refusal)", new RegExp(`^the URL given for the comparison of the grants names another database than ${DB}: nothing compared, refused`));
      assert.match(r.error, NOT_HERE);
      assert.equal(r.error.includes("\n") || /fewer|more than/.test(r.error), false, "one line, no count of grants");
    }
    // a table of the same name in the OTHER database, with a right in excess: it is not the service's, and
    // the gesture on the owner's own URL does not see it
    await admin.unsafe(`grant create on database ${other} to rw_owner`);
    const planted = postgres(elsewhere("rw_owner"), { max: 1, onnotice: () => {} });
    try { await planted.unsafe("create schema rw; create table rw.upload (x int); grant usage on schema rw to rw_app; grant delete on rw.upload to rw_app"); } finally { await planted.end(); }
    assert.deepEqual(await run(), { grants: expected.length }, "the other database's objects are not read");
    assert.match((await run(elsewhere("rw_owner"))).error ?? "(no refusal)", NOT_HERE, "and that database is still refused, now that it holds a schema rw");
    // production's shape: an administrator that may NOT connect to the service database, and whose URL
    // names the other one. Its own gesture passes (what it reads is the server's), the owner's comparison
    // passes, and a drift is still refused: nothing here needs the administrator in the service database
    const stand = `rw_test_admin_${randomBytes(4).toString("hex")}`;
    await adminDb.unsafe(`create role ${stand} login createrole; grant rw_resolve to ${stand} with admin option`);
    await adminDb.unsafe(`revoke connect on database ${DB} from public`);
    try {
      const refusedSession = postgres(urlAs(stand), { max: 1, onnotice: () => {} });
      const denied = await refusedSession`select 1`.then(() => "(connected)", (e) => e.message).finally(() => refusedSession.end());
      assert.match(denied, /permission denied for database/, "the stand-in administrator cannot connect to the service database, as rw_admin at the hoster");
      assert.deepEqual(await roles(elsewhere(stand), { log: () => {} }), { temporaryRevoked: true }, "roles, from the other database, as that administrator");
      assert.deepEqual(await run(), { grants: expected.length }, "grants, as rw_owner, on the service database");
      for (const [what, plant, undo, said] of [
        ["a DELETE for the service", "grant delete on rw.upload to rw_app", "revoke delete on rw.upload from rw_app", /: 1 more than the snapshot \(rw\.upload rw_app DELETE\)$/],
        ["a grant of db/grants.sql gone", "revoke select on rw.reader from rw_maint", "grant select on rw.reader to rw_maint", /: 1 fewer \(rw\.reader rw_maint SELECT\)$/],
      ]) {
        await adminDb.unsafe(plant);
        try { assert.match((await run()).error ?? "(no refusal)", said, what); } finally { await adminDb.unsafe(undo); }
      }
      // the comparison asked of a role that cannot connect to the service database (what `roles --grants`
      // was at the hoster): said as such, in one line, never a count
      const r = await run(urlAs(stand));
      assert.match(r.error ?? "(no refusal)", new RegExp(`^cannot connect to the service database ${DB} as ${stand}: .*permission denied for database`), r.error);
      assert.equal(r.error.includes("\n"), false, "one line");
      assert.equal(/fewer|more than/.test(r.error), false, "no count of grants");
    } finally {
      await adminDb.unsafe(`grant connect on database ${DB} to public`);
      await adminDb.unsafe(`revoke rw_resolve from rw_owner granted by ${stand}`).catch(() => {});
      await adminDb.unsafe(`drop owned by ${stand}; drop role ${stand}`);
    }
    assert.deepEqual(await run(), { grants: expected.length }, "the base is as it was");
  } finally { await admin.unsafe(`drop database if exists ${other} with (force)`); }
});

test("catalog: every security definer function of rw sets search_path to pg_catalog, rw, pg_temp, in that order", async () => {
  const rows = await adminDb`select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'rw' and p.prosecdef order by 1`;
  assert.equal(rows.length, 21, "the fifteen of the floor and the six of the forge port (0007)");
  for (const r of rows) assert.deepEqual(r.proconfig, ["search_path=pg_catalog, rw, pg_temp"], r.proname);
});

// The schema the migrations build, committed (checklist-day-zero-project: schema drift): tables, columns,
// constraints, indexes, policies, functions (with their settings), triggers and grants of rw and rw_meta (on the tables,
// on the two schemas, and CONNECT and CREATE on the database for the three login roles). A migration that
// changes any of them changes db/schema.snapshot.txt in the same diff (UPDATE_SCHEMA_SNAPSHOT=1 writes it).
test("the schema the migrations build is the committed snapshot (no drift)", async () => {
  const lines = (await adminDb.unsafe(`
    select format('table %s.%s rls=%s force=%s', n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity) as l from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('rw', 'rw_meta') and c.relkind = 'r'
    union all select format('column %s.%s.%s %s null=%s default=%s', table_schema, table_name, column_name, data_type, is_nullable, coalesce(column_default, '')) from information_schema.columns where table_schema in ('rw', 'rw_meta')
    union all select format('constraint %s %s %s', conrelid::regclass, conname, pg_get_constraintdef(c.oid)) from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname in ('rw', 'rw_meta')
    union all select format('index %s', indexdef) from pg_indexes where schemaname in ('rw', 'rw_meta')
    union all select format('policy %s.%s %s %s to=%s using=%s check=%s', schemaname, tablename, policyname, cmd, roles, coalesce(qual, ''), coalesce(with_check, '')) from pg_policies where schemaname in ('rw', 'rw_meta')
    union all select format('function %s.%s(%s) definer=%s owner=%s config=%s', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef, pg_get_userbyid(p.proowner), coalesce(array_to_string(p.proconfig, '; '), '')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('rw', 'rw_meta')
    union all select format('trigger %s', pg_get_triggerdef(t.oid)) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname in ('rw', 'rw_meta')
    union all select format('grant %s.%s %s %s', table_schema, table_name, grantee, privilege_type) from information_schema.role_table_grants where table_schema in ('rw', 'rw_meta') and grantee like 'rw\\_%'
    union all select format('grant schema %s %s %s', n.nspname, r.rolname, p) from pg_namespace n cross join pg_roles r cross join unnest(array['USAGE', 'CREATE']) as p where n.nspname in ('rw', 'rw_meta') and r.rolname in ('rw_owner', 'rw_resolve', 'rw_app', 'rw_maint') and has_schema_privilege(r.oid, n.oid, p)
    union all select format('grant database %s %s', r.rolname, p) from pg_roles r cross join unnest(array['CONNECT', 'CREATE']) as p where r.rolname in ('rw_owner', 'rw_app', 'rw_maint') and has_database_privilege(r.oid, current_database(), p)
  `)).map((r) => r.l).sort();
  const text = `${lines.join("\n")}\n`;
  if (process.env.UPDATE_SCHEMA_SNAPSHOT === "1") writeFileSync(SNAPSHOT, text);
  const committed = readFileSync(SNAPSHOT, "utf8");
  const was = new Set(committed.split("\n")), now = new Set(lines);
  const added = lines.filter((l) => !was.has(l)), gone = [...was].filter((l) => l && !now.has(l));
  assert.deepEqual({ added, gone }, { added: [], gone: [] }, "the schema drifted from db/schema.snapshot.txt: commit the snapshot with the migration (UPDATE_SCHEMA_SNAPSHOT=1)");
});
