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
import { replay } from "../../scripts/replay-export.mjs";

const ADMIN = process.env.PG_ADMIN_URL;
if (!ADMIN) { test("PG_ADMIN_URL is set", () => assert.fail("PG_ADMIN_URL is required: this suite never skips silently")); }
const DB = `rw_test_${randomBytes(4).toString("hex")}`;
const urlAs = (role) => { const u = new URL(ADMIN); u.username = role; u.password = ""; u.pathname = `/${DB}`; return u.toString(); };
let admin, adminDb, store, h, A, B, firstRun;
const MIGRATIONS = readdirSync(new URL("../../db/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
const TENANT_TABLES = ["member", "passkey", "session", "link", "forge_repository", "repository", "mission", "upload", "blob", "fleet_index", "reader", "archive", "ledger"];

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
    for (const t of ["webauthn_challenge", "oidc_jti", "rate_counter", "refused_counter", "operator_journal", "service_state"]) await assert.rejects(sql.unsafe(`select * from rw.${t}`), /permission denied/, t);
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
  assert.deepEqual(defs, ["count_refused", "maintenance", "name_taken", "operator_note", "put_challenge", "resolve_credential", "resolve_link", "resolve_repository", "resolve_session", "set_maintenance", "take_challenge", "take_rate", "tenant_ids", "use_jti"].map((f) => `${f}:rw_resolve`));
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
  const r = replay(a.bytes, "0.46.0");
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

// The schema the migrations build, committed (checklist-day-zero-project: schema drift): tables, columns,
// constraints, indexes, policies, functions, triggers and grants of rw and rw_meta. A migration that
// changes any of them changes db/schema.snapshot.txt in the same diff (UPDATE_SCHEMA_SNAPSHOT=1 writes it).
const SNAPSHOT = new URL("../../db/schema.snapshot.txt", import.meta.url).pathname;
test("the schema the migrations build is the committed snapshot (no drift)", async () => {
  const lines = (await adminDb.unsafe(`
    select format('table %s.%s rls=%s force=%s', n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity) as l from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('rw', 'rw_meta') and c.relkind = 'r'
    union all select format('column %s.%s.%s %s null=%s default=%s', table_schema, table_name, column_name, data_type, is_nullable, coalesce(column_default, '')) from information_schema.columns where table_schema in ('rw', 'rw_meta')
    union all select format('constraint %s %s %s', conrelid::regclass, conname, pg_get_constraintdef(c.oid)) from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname in ('rw', 'rw_meta')
    union all select format('index %s', indexdef) from pg_indexes where schemaname in ('rw', 'rw_meta')
    union all select format('policy %s.%s %s %s to=%s using=%s check=%s', schemaname, tablename, policyname, cmd, roles, coalesce(qual, ''), coalesce(with_check, '')) from pg_policies where schemaname in ('rw', 'rw_meta')
    union all select format('function %s.%s(%s) definer=%s owner=%s', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef, pg_get_userbyid(p.proowner)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('rw', 'rw_meta')
    union all select format('trigger %s', pg_get_triggerdef(t.oid)) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname in ('rw', 'rw_meta')
    union all select format('grant %s.%s %s %s', table_schema, table_name, grantee, privilege_type) from information_schema.role_table_grants where table_schema in ('rw', 'rw_meta') and grantee like 'rw\\_%'
  `)).map((r) => r.l).sort();
  const text = `${lines.join("\n")}\n`;
  if (process.env.UPDATE_SCHEMA_SNAPSHOT === "1") writeFileSync(SNAPSHOT, text);
  const committed = readFileSync(SNAPSHOT, "utf8");
  const was = new Set(committed.split("\n")), now = new Set(lines);
  const added = lines.filter((l) => !was.has(l)), gone = [...was].filter((l) => l && !now.has(l));
  assert.deepEqual({ added, gone }, { added: [], gone: [] }, "the schema drifted from db/schema.snapshot.txt: commit the snapshot with the migration (UPDATE_SCHEMA_SNAPSHOT=1)");
});
